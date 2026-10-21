import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import { generateSuite } from '../verify/synthetic';
import { evaluate, invokeBounded, POLICY } from '../verify/engine';
import { suiteSchema, outputSchema, toolRequestSchema } from '../verify/contracts';
import { agentSchema, resolveAdapter, requireAllowedTool, executeTool, type ModelEnvironment } from '../forge/agents';

interface Principal { orgId: string; userId: string; role: 'builder' | 'reviewer' }
export interface Bindings extends ModelEnvironment {
  DB: D1Database; ASSETS?: Fetcher; AUTH_PRINCIPALS?: string;
}
type Environment = { Bindings: Bindings; Variables: { principal: Principal } };
type AgentRow = { id: string; config: string; created_at: string };
type ExecutionRow = {
  id: string; agent_id: string; requested_by: string; status: string;
  output: string; tool_request: string | null; tool_result: string | null;
  reviewed_by: string | null; created_at: string;
};
const principalSchema = z.array(z.object({
  token: z.string().min(24), orgId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100), role: z.enum(['builder', 'reviewer'])
})).min(1).refine(rows => new Set(rows.map(row => row.token)).size === rows.length, { message: 'Credentials must be unique' });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const baselineId = z.enum(['policy-v1', 'always-approve-v1', 'always-escalate-v1']);

// Fixed-length digest comparison avoids ordinary early-exit string comparison.
async function matchesToken(given: string, expected: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export const app = new Hono<Environment>();
app.use('*', secureHeaders());
app.use('/api/*', bodyLimit({ maxSize: 262144, onError: c => c.json({ error: 'Request too large' }, 413) }));
app.get('/api/health', c => c.json({ status: 'ok', engine: 'verify-v1' }));
app.use('/api/*', async (c, next) => {
  const parsed = principalSchema.safeParse((() => { try { return JSON.parse(c.env.AUTH_PRINCIPALS ?? 'null'); } catch { return null; } })());
  if (!parsed.success) throw new HTTPException(503, { message: 'Authentication is not configured' });
  const authorization = c.req.header('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 4096)
    throw new HTTPException(401, { message: 'Bearer credential required' });
  let principal: Principal | undefined;
  for (const candidate of parsed.data) {
    if (await matchesToken(authorization.slice(7), candidate.token))
      principal = { orgId: candidate.orgId, userId: candidate.userId, role: candidate.role };
  }
  if (!principal) throw new HTTPException(401, { message: 'Invalid credential' });
  c.set('principal', principal);
  c.header('Cache-Control', 'no-store');
  await next();
});
app.get('/api/me', c => c.json(c.get('principal')));
app.post('/api/verify/suites', async c => c.json(generateSuite(await c.req.json())));
app.post('/api/verify/runs', async c => {
  const body = z.object({ suite: suiteSchema, baseline: baselineId.default('policy-v1') }).strict().parse(await c.req.json());
  const report = await evaluate(body.suite, resolveAdapter(body.baseline, c.env));
  const runId = id(), org = c.get('principal').orgId;
  await c.env.DB.prepare('INSERT INTO evaluations (org_id,id,report,created_at) VALUES (?,?,?,?)')
    .bind(org, runId, JSON.stringify(report), now()).run();
  return c.json({ id: runId, ...report }, 201);
});
app.get('/api/verify/runs', async c => {
  const rows = await c.env.DB.prepare('SELECT id, agent_id, report, created_at FROM evaluations WHERE org_id=? ORDER BY created_at DESC LIMIT 50')
    .bind(c.get('principal').orgId).all<{ id: string; agent_id: string | null; report: string; created_at: string }>();
  return c.json(rows.results.map(r => ({ id: r.id, agentId: r.agent_id, createdAt: r.created_at, ...JSON.parse(r.report) })));
});
app.get('/api/verify/runs/:id', async c => {
  const row = await c.env.DB.prepare('SELECT report FROM evaluations WHERE org_id=? AND id=?')
    .bind(c.get('principal').orgId, c.req.param('id')).first<{ report: string }>();
  if (!row) throw new HTTPException(404);
  return c.json(JSON.parse(row.report));
});
app.post('/api/forge/agents', async c => {
  if (c.get('principal').role !== 'builder') throw new HTTPException(403);
  const config = agentSchema.parse(await c.req.json());
  const agentId = id(), principal = c.get('principal');
  await c.env.DB.prepare('INSERT INTO agents (org_id,id,name,config,created_by,created_at) VALUES (?,?,?,?,?,?)')
    .bind(principal.orgId, agentId, config.name, JSON.stringify(config), principal.userId, now()).run();
  return c.json({ id: agentId, ...config }, 201);
});
app.get('/api/forge/agents', async c => {
  const rows = await c.env.DB.prepare('SELECT id, config, created_at FROM agents WHERE org_id=? ORDER BY created_at DESC LIMIT 50')
    .bind(c.get('principal').orgId).all<AgentRow>();
  return c.json(rows.results.map(r => ({ id: r.id, createdAt: r.created_at, ...JSON.parse(r.config) })));
});
async function getAgent(db: D1Database, org: string, agentId: string) {
  const row = await db.prepare('SELECT config FROM agents WHERE org_id=? AND id=?').bind(org, agentId).first<{ config: string }>();
  if (!row) throw new HTTPException(404);
  return agentSchema.parse(JSON.parse(row.config));
}
app.post('/api/forge/agents/:id/evaluate', async c => {
  const principal = c.get('principal');
  const config = await getAgent(c.env.DB, principal.orgId, c.req.param('id'));
  // Only offline baselines in synchronous API evaluation; remote evaluation is intentionally gated.
  if (config.adapter === 'http') throw new HTTPException(409, { message: 'Remote batch evaluation requires a future bounded queue runner' });
  const suite = suiteSchema.parse(await c.req.json());
  const report = await evaluate(suite, resolveAdapter(config.adapter, c.env), { instructions: config.instructions });
  const runId = id();
  await c.env.DB.prepare('INSERT INTO evaluations (org_id,id,agent_id,report,created_at) VALUES (?,?,?,?,?)')
    .bind(principal.orgId, runId, c.req.param('id'), JSON.stringify(report), now()).run();
  return c.json({ id: runId, ...report }, 201);
});
app.post('/api/forge/agents/:id/execute', async c => {
  const principal = c.get('principal');
  if (principal.role !== 'builder') throw new HTTPException(403);
  const config = await getAgent(c.env.DB, principal.orgId, c.req.param('id'));
  const body = z.object({
    input: z.string().min(1).max(10000),
    // Explicitly supports testing the tool/approval path without a paid model.
    tool: toolRequestSchema.optional()
  }).strict().parse(await c.req.json());
  const adapter = resolveAdapter(config.adapter, c.env);
  const output = await invokeBounded(adapter, { caseId: id(), input: body.input, instructions: config.instructions });
  const request = body.tool ?? output.tools[0] ?? null;
  if (body.tool && output.tools.length) throw new HTTPException(400, { message: 'Ambiguous tool request' });
  if (request) {
    try { requireAllowedTool(config, request); } catch { throw new HTTPException(403, { message: 'Tool is not allowed' }); }
  }
  const pending = request?.name === 'refund.preview';
  const result = request && !pending ? executeTool(request) : null;
  const executionId = id(), status = pending ? 'pending' : 'completed';
  await c.env.DB.prepare('INSERT INTO executions (org_id,id,agent_id,requested_by,status,output,tool_request,tool_result,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(principal.orgId, executionId, c.req.param('id'), principal.userId, status,
      JSON.stringify(output), request ? JSON.stringify(request) : null, result ? JSON.stringify(result) : null, now()).run();
  return c.json({ id: executionId, status, output, tool: request, result }, 201);
});
app.get('/api/forge/executions', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM executions WHERE org_id=? ORDER BY created_at DESC LIMIT 50')
    .bind(c.get('principal').orgId).all<ExecutionRow>();
  return c.json(rows.results.map(r => ({
    id: r.id, agentId: r.agent_id, status: r.status, requestedBy: r.requested_by,
    reviewedBy: r.reviewed_by, createdAt: r.created_at,
    output: outputSchema.parse(JSON.parse(r.output)),
    tool: r.tool_request ? JSON.parse(r.tool_request) : null,
    result: r.tool_result ? JSON.parse(r.tool_result) : null
  })));
});
app.post('/api/forge/executions/:id/review', async c => {
  const principal = c.get('principal');
  if (principal.role !== 'reviewer') throw new HTTPException(403);
  const { approve } = z.object({ approve: z.boolean() }).strict().parse(await c.req.json());
  const row = await c.env.DB.prepare('SELECT * FROM executions WHERE org_id=? AND id=?')
    .bind(principal.orgId, c.req.param('id')).first<ExecutionRow>();
  if (!row) throw new HTTPException(404);
  if (row.requested_by === principal.userId) throw new HTTPException(403, { message: 'A different person must review this execution' });
  if (row.status !== 'pending' || !row.tool_request) throw new HTTPException(409, { message: 'Execution is no longer pending' });
  const request = toolRequestSchema.parse(JSON.parse(row.tool_request));
  requireAllowedTool(await getAgent(c.env.DB, principal.orgId, row.agent_id), request);
  // The tool is a pure preview. The result and review decision commit atomically.
  // Real external side effects must add an outbox + provider idempotency first.
  const result = approve ? executeTool(request) : null;
  const status = approve ? 'completed' : 'rejected';
  const update = await c.env.DB.prepare("UPDATE executions SET status=?, tool_result=?, reviewed_by=?, reviewed_at=? WHERE org_id=? AND id=? AND status='pending'")
    .bind(status, result ? JSON.stringify(result) : null, principal.userId, now(), principal.orgId, row.id).run();
  if (update.meta.changes !== 1) throw new HTTPException(409, { message: 'Execution was already reviewed' });
  return c.json({ id: row.id, status, result });
});
app.onError((error, c) => {
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: 'Invalid request', ...(error instanceof ZodError ? { issues: error.issues.map(i => ({ path: i.path, message: i.message })) } : {}) }, 400);
  if (error instanceof HTTPException) return c.json({ error: error.message || 'Request rejected' }, error.status);
  // No provider responses, secrets or stack traces are exposed to API callers.
  return c.json({ error: 'Operation failed; check configuration and retry' }, 500);
});
app.notFound(c => c.json({ error: 'Not found' }, 404));
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    if (new URL(request.url).pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Build the UI first', { status: 503 });
  }
};



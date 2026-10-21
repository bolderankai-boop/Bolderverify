import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app, type Bindings } from '../src/api/index';
import { generateSuite } from '../src/verify/synthetic';

// Executes the actual migration and SQL. The thin binding shim only adapts
// SQLite results to D1's interface; Worker-runtime smoke tests are separate.
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  function prepare(sql: string, values: (string | number | null)[] = []): unknown {
    return {
      bind(...args: (string | number | null)[]) { return prepare(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }
    };
  }
  const principals = [
    { token: 'builder-token-at-least-24-characters', orgId: 'alpha', userId: 'alice', role: 'builder' },
    { token: 'reviewer-token-at-least-24-characters', orgId: 'alpha', userId: 'bob', role: 'reviewer' },
    { token: 'outsider-token-at-least-24-characters', orgId: 'beta', userId: 'eve', role: 'builder' },
    { token: 'selfreview-token-at-least-24-characters', orgId: 'alpha', userId: 'alice', role: 'reviewer' }
  ];
  const env: Bindings = { DB: { prepare } as D1Database, AUTH_PRINCIPALS: JSON.stringify(principals) };
  async function call(path: string, body?: unknown, who = 0) {
    return app.request('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + (principals[who]?.token ?? 'invalid'), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, env);
  }
  return { sqlite, env, call };
}
interface Payload { id: string; status: string; metrics: { accuracy: number }; result: { simulated: boolean; maxRefundDays: number } | null; reviewedBy: string }
const config = { name: 'Support', instructions: 'Refund policy', adapter: 'policy-v1', allowedTools: ['policy.lookup', 'refund.preview'] };
test('API fails closed when auth is missing or token is invalid', async t => {
  const { call, env, sqlite } = setup(); t.after(() => sqlite.close());
  assert.equal((await call('/me', undefined, 99)).status, 401);
  assert.equal((await app.request('/api/me', {}, { ...env, AUTH_PRINCIPALS: undefined })).status, 503);
  assert.equal((await app.request('/api/health', {}, env)).status, 200);
});
test('Verify API persists reproducible reports and prevents cross-org reads', async t => {
  const { call, sqlite } = setup(); t.after(() => sqlite.close());
  const created = await call('/verify/runs', { suite: generateSuite(), baseline: 'policy-v1' });
  assert.equal(created.status, 201); const report = await created.json<Payload>();
  assert.equal(report.metrics.accuracy, 1);
  assert.equal((await call('/verify/runs/' + report.id)).status, 200);
  assert.equal((await call('/verify/runs/' + report.id, undefined, 2)).status, 404);
  assert.deepEqual(await (await call('/verify/runs', undefined, 2)).json<Payload>(), []);
  const bad = await call('/verify/runs', { suite: generateSuite(), baseline: 'http' });
  assert.equal(bad.status, 400);
});
test('Forge isolates agents and rejects spoofed organisation or reviewer creation', async t => {
  const { call, sqlite } = setup(); t.after(() => sqlite.close());
  assert.equal((await call('/forge/agents', { ...config, orgId: 'beta' })).status, 400);
  assert.equal((await call('/forge/agents', config, 1)).status, 403);
  const agent = await (await call('/forge/agents', config)).json<Payload>();
  assert.deepEqual(await (await call('/forge/agents', undefined, 2)).json<Payload>(), []);
  assert.equal((await call('/forge/agents/' + agent.id + '/execute', { input: '{}' }, 2)).status, 404);
  assert.equal((await call('/forge/agents/' + agent.id + '/evaluate', generateSuite(), 2)).status, 404);
  const report = await (await call('/forge/agents/' + agent.id + '/evaluate', generateSuite())).json<Payload>();
  assert.equal(report.metrics.accuracy, 1);
});
test('pending previews require a distinct reviewer and only commit once', async t => {
  const { call, sqlite } = setup(); t.after(() => sqlite.close());
  const agent = await (await call('/forge/agents', config)).json<Payload>();
  const execution = await (await call('/forge/agents/' + agent.id + '/execute', {
    input: '{"days":12}', tool: { name: 'refund.preview', args: { days: 12 } }
  })).json<Payload>();
  assert.equal(execution.status, 'pending'); assert.equal(execution.result, null);
  const path = '/forge/executions/' + execution.id + '/review';
  assert.equal((await call(path, { approve: true })).status, 403);
  assert.equal((await call(path, { approve: true }, 3)).status, 403);
  const reviews = await Promise.all([call(path, { approve: true }, 1), call(path, { approve: true }, 1)]);
  assert.deepEqual(reviews.map(r => r.status).sort(), [200,409]);
  const completed = (await (await call('/forge/executions')).json<Payload[]>())[0];
  assert.equal(completed.result?.simulated, true);
  assert.equal(completed.reviewedBy, 'bob');
  assert.equal(completed.status, 'completed');
});
test('denial performs no tool execution and tool allowlist cannot be bypassed', async t => {
  const { call, sqlite } = setup(); t.after(() => sqlite.close());
  const agent = await (await call('/forge/agents', { ...config, allowedTools: [] })).json<Payload>();
  const payload = { input: '{"days":12}', tool: { name: 'refund.preview', args: { days: 12 } } };
  assert.equal((await call('/forge/agents/' + agent.id + '/execute', payload)).status, 403);
  assert.equal((await call('/forge/agents/' + agent.id + '/execute', { ...payload, tool: { name: 'shell', args: {} } })).status, 400);
  const allowed = await (await call('/forge/agents', config)).json<Payload>();
  const execution = await (await call('/forge/agents/' + allowed.id + '/execute', payload)).json<Payload>();
  assert.equal((await call('/forge/executions/' + execution.id + '/review', { approve: false }, 1)).status, 200);
  const denied = (await (await call('/forge/executions')).json<Payload[]>())[0];
  assert.equal(denied.status, 'rejected'); assert.equal(denied.result, null);
});
test('read-only tools execute immediately; remote models stay off by default', async t => {
  const { call, sqlite } = setup(); t.after(() => sqlite.close());
  const agent = await (await call('/forge/agents', config)).json<Payload>();
  const result = await (await call('/forge/agents/' + agent.id + '/execute', { input: '{"days":12}', tool: { name: 'policy.lookup', args: { days: null } } })).json<Payload>();
  assert.equal(result.status, 'completed'); assert.equal(result.result?.maxRefundDays, 30);
  const remote = await (await call('/forge/agents', { ...config, adapter: 'http' })).json<Payload>();
  assert.equal((await call('/forge/agents/' + remote.id + '/execute', { input: '{}' })).status, 500);
  assert.equal((await call('/forge/agents/' + remote.id + '/evaluate', generateSuite())).status, 409);
});
test('body limits, malformed JSON and unknown routes produce controlled errors', async t => {
  const { call, env, sqlite } = setup(); t.after(() => sqlite.close());
  assert.equal((await call('/verify/suites', { count: 999 })).status, 400);
  assert.equal((await call('/forge/agents', { ...config, instructions: 'x'.repeat(300000) })).status, 413);
  const bad = await app.request('/api/forge/agents', { method: 'POST', headers: { Authorization: 'Bearer builder-token-at-least-24-characters', 'Content-Type': 'application/json' }, body: '{' }, env);
  assert.equal(bad.status, 400);
  assert.equal((await call('/unknown')).status, 404);
});



import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
const builder = 'replace-with-long-local-builder-token', reviewer = 'replace-with-long-local-reviewer-token';
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try { ready = (await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(ready, 'Local API must be running');
async function request(path: string, body?: unknown, token = builder) {
  return fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000)
  });
}
const suiteResponse = await request('/verify/suites', { seed: 42, count: 24 });
assert.equal(suiteResponse.status, 200);
const suite = await suiteResponse.json();
const run = await request('/verify/runs', { suite, baseline: 'policy-v1' });
assert.equal(run.status, 201);
const report = await run.json() as { id: string; metrics: { accuracy: number } };
assert.equal(report.metrics.accuracy, 1);
assert.equal((await request('/verify/runs/' + report.id)).status, 200);
const agentResponse = await request('/forge/agents', { name: 'HTTP smoke', instructions: 'Refund policy', adapter: 'policy-v1', allowedTools: ['refund.preview'] });
assert.equal(agentResponse.status, 201);
const agent = await agentResponse.json() as { id: string };
assert.equal((await request('/forge/agents/' + agent.id + '/evaluate', suite)).status, 201);
const executionResponse = await request('/forge/agents/' + agent.id + '/execute', {
  input: '{"days":12}', tool: { name: 'refund.preview', args: { days: 12 } }
});
assert.equal(executionResponse.status, 201);
const execution = await executionResponse.json() as { id: string; status: string; result: unknown };
assert.equal(execution.status, 'pending'); assert.equal(execution.result, null);
const reviewPath = '/forge/executions/' + execution.id + '/review';
assert.equal((await request(reviewPath, { approve: true })).status, 403);
assert.equal((await request(reviewPath, { approve: true }, reviewer)).status, 200);
assert.equal((await request(reviewPath, { approve: true }, reviewer)).status, 409);
assert.equal((await request('/me', undefined, 'invalid')).status, 401);
console.log('HTTP smoke passed: Verify persistence, Forge evaluation, pending approval, reviewer role and replay protection.');


import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSuite } from '../src/verify/synthetic';
import { baseline, httpAdapter } from '../src/verify/adapters';
import { evaluate, compareReports } from '../src/verify/engine';
import type { Adapter } from '../src/verify/contracts';

test('seed and generator version reproduce data and outcome hashes', async () => {
  const a = generateSuite({ seed: 72 }), b = generateSuite({ seed: 72 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateSuite({ seed: 73 }));
  const first = await evaluate(a, baseline('policy-v1')), second = await evaluate(b, baseline('policy-v1'));
  assert.equal(first.outcomeHash, second.outcomeHash);
  assert.equal(first.metrics.accuracy, 1);
  assert.deepEqual(Object.keys(first.metrics.byCategory).sort(), ['boundary','conflicting-evidence','eligible','expired','injection','missing-evidence']);
  assert.equal(first.metrics.confusion.deny.deny, 8);
});
test('weak baselines expose failures and comparisons identify regressions', async () => {
  const suite = generateSuite();
  const good = await evaluate(suite, baseline('policy-v1'));
  const weak = await evaluate(suite, baseline('always-approve-v1'));
  assert.equal(weak.metrics.accuracy, 1 / 3);
  assert.equal(compareReports(good, weak).filter(r => r.change === 'regressed').length, 16);
  assert.throws(() => compareReports(good, { ...weak, manifest: { ...weak.manifest, suiteHash: 'different' } }));
});
test('expected answers never enter the adapter and mutation cannot change grading', async () => {
  const suite = generateSuite({ count: 6 });
  let calls = 0;
  const adapter: Adapter = { id: 'spy-v1', deterministic: true, async invoke(input) {
    calls++;
    assert.deepEqual(Object.keys(input).sort(), ['caseId', 'input', 'instructions']);
    input.caseId = 'mutated';
    return { decision: 'approve' };
  }};
  const report = await evaluate(suite, adapter);
  assert.equal(calls, 6);
  assert.equal(report.results[0].caseId, 'refund-000');
});
test('malformed, thrown and noncooperative timeout results count as errors', async () => {
  for (const invoke of [
    async () => ({ decision: 'yes' }),
    async () => { throw new Error('secret provider credentials'); },
    async () => new Promise(() => {})
  ]) {
    const report = await evaluate(generateSuite({ count: 6 }), { id: 'bad-v1', deterministic: false, invoke }, { timeoutMs: 5 });
    assert.equal(report.metrics.errors, 6);
    assert.equal(report.metrics.accuracy, 0);
    assert.equal(report.metrics.total, 6);
    assert.ok(!JSON.stringify(report).includes('secret provider credentials'));
  }
});
test('validation rejects duplicate IDs, oversized suites, invalid seeds and timeout values', async () => {
  assert.throws(() => generateSuite({ seed: -1 }));
  assert.throws(() => generateSuite({ count: 101 }));
  const suite = generateSuite({ count: 6 }); suite.cases[1].id = suite.cases[0].id;
  await assert.rejects(() => evaluate(suite, baseline('policy-v1')));
  await assert.rejects(() => evaluate(generateSuite(), baseline('policy-v1'), { timeoutMs: Infinity }));
});
test('HTTP adapter forwards bounded inputs with no redirects and handles response limits', async () => {
  let payload: unknown;
  const adapter = httpAdapter({ endpoint: 'https://model.example/evaluate', revision: 'v1', token: 'server-secret' }, (async (_url, options) => {
    assert.equal(options?.redirect, 'error');
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ decision: 'approve' }));
  }) as typeof fetch);
  const input = { caseId: 'a', input: 'test', instructions: 'policy' };
  assert.deepEqual(await adapter.invoke(input, new AbortController().signal), { decision: 'approve' });
  assert.deepEqual(payload, input);
  assert.throws(() => httpAdapter({ endpoint: 'http://model.example', revision: 'v1' }));
  const large = httpAdapter({ endpoint: 'https://model.example', revision: 'v1' }, (async () => new Response('x'.repeat(70000))) as typeof fetch);
  await assert.rejects(() => large.invoke(input, new AbortController().signal), /too large/);
});


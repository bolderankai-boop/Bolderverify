# Verification evidence — 21 October 2026

## Completed locally

- 13 new TypeScript engine/API tests pass.
- 6 original prototype tests pass.
- Strict TypeScript checking passes.
- Vite production UI build passes (about 73 KiB compressed JavaScript).
- Frozen pnpm lockfile installation succeeds.
- CLI seed-42 policy baseline: 24/24 correct; accuracy 1.0.
- Seeded suite and outcome hashes match across repeated deterministic runs.
- Negative baseline scores 1/3 and yields 16 regressions against policy-v1.
- HTTP smoke passes: persisted Verify report, agent-linked evaluation, pending
  tool execution, reviewer role enforcement, duplicate approval protection,
  invalid credentials rejected.
- Real browser on the Node/SQLite fallback: connected as local builder, ran and
  saved a 24-case benchmark, created an agent, requested a preview, switched to
  reviewer and approved it. UI displayed completed status and simulated result.
  Browser console warnings/errors: none observed.
- Original dist/, serve.mjs, run.mjs and original test file are unchanged.

Tests execute the real SQL migration and organisation-scoped queries against
SQLite, including a concurrent review race. They cover cross-organisation reads,
role restrictions, self-review rejection, tool allowlists, rejection without
execution, request limits, malformed JSON, model output errors/timeouts, response
limits, expected-answer withholding and disabled remote model configuration.

## Runtime limitation

The native Cloudflare workerd process crashes on this Windows host with access
violation 0xc0000005 before local D1 migration can run. It also fails outside the
sandbox. This does not establish a specific root cause. No runtime changes were
made to the machine. Node/SQLite validation is not proof of D1/Worker compatibility.

The Linux CI workflow includes local migration and HTTP smoke checks against
Wrangler. Its result must be inspected before merging. No remote Cloudflare
resource, account, domain or DNS setting has been accessed or modified.

## Boundaries

No live paid provider tested; HTTP adapter tests use controlled fetch fixtures.
No production authentication, signup, hosted remote batches, external tool side
effects or real refund processing is claimed. Mobile styling exists but has not
had a separate device test. This PR is a development foundation and Forge scaffold,
not a production launch or a website migration.


# Bolderank Verify + Forge

TypeScript, Hono, React and a Cloudflare D1 schema. Verify is a reproducible
agent decision evaluation engine; Forge is an organisation-scoped builder
scaffold that reuses Verify and enforces controlled tool approvals.

The original browser prototype remains in `dist/`, untouched. New UI output goes
to `build/web/`. No deployment, DNS change or website migration is included.

## Local development

Use Node **24+** and pnpm 11.25.0. No cloud account or paid model is required.

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
# PowerShell: Copy-Item .dev.vars.example .dev.vars
pnpm test
pnpm build
pnpm dev:local
```

Open http://127.0.0.1:8787. Use the builder credential from `.dev.vars` to create
agents and request tools. Disconnect and use the separate reviewer credential
to approve or reject. Example credentials are for local synthetic testing only;
replace them before any shared environment. Tokens stay in browser memory.

`dev:local` runs the Hono routes with SQLite in `.local/` using the same SQL
migration as D1. It is a development fallback, **not Worker-runtime verification**.
For hot reload, run `pnpm dev` separately; Vite proxies /api to port 8787.

### Cloudflare local runtime

```sh
pnpm build
pnpm db:local
pnpm dev:api
```

These commands use local storage only. On the Windows host used for this change,
workerd crashed before starting. The Node fallback was tested end to end; CI
also exercises the local Worker on Linux. See [verification](docs/VERIFICATION.md).

## Verify

```sh
pnpm verify                       # seed 42, policy-v1
pnpm verify 42 always-approve-v1   # intentionally weak comparator
```

The CLI writes `results.json`. Reports embed the suite, generator version, seed,
engine version, adapter revision, instruction hash, suite SHA-256 and outcome
SHA-256. Equal data and deterministic adapter configuration reproduce the outcome
hash. Timing is measured separately and excluded from that hash.

- Seeded refund cases: eligibility, expiry, day-30 boundary, missing/conflicting
  evidence and instruction injection.
- Three baselines: policy-v1, always-approve-v1, always-escalate-v1.
- Exact decision accuracy, pass/failure/error counts, category counts, confusion
  matrix, mean latency and nearest-rank p95 latency.
- Invalid outputs, exceptions and timeouts remain in the denominator.
- Expected answers never enter adapters. Tools never execute during evaluation.
- Comparisons require matching suite hashes and engine versions.
- API accepts custom suites following the schema and generated suites.

Synthetic results are not industry certification. The engine grades three exact
decision labels, not free-text reasoning. Remote model nondeterminism, provider
changes and external state may affect results. Timeout signals cancellation and
stops waiting; trusted adapters must cooperate. Arbitrary adapter code is not
sandboxed.

## Forge scaffold

- Immutable organisation-scoped agent configurations and persisted evaluations.
- Server-owned credential-to-organisation/user/role mapping, with no caller-selected
  tenant. This is bootstrap authentication, not production SSO.
- Deterministic and explicitly enabled HTTP adapters. Baselines ignore custom
  instructions; the HTTP adapter receives them.
- Fixed allowlisted policy lookup and refund preview tools, with no shell,
  eval, arbitrary code execution or external writes.
- Previews stay pending until a distinct reviewer in the same organisation
  approves or rejects. Concurrent/duplicate reviews return 409.
- React UI: evaluations, case results, export, history comparison, agent creation,
  tool execution and approval review.

Remote models are disabled by default. No provider subscription is needed.
Administrators may configure a trusted HTTPS adapter; see [API](docs/API.md).
Hosted remote batch evaluation, autonomous multi-step planning, signup/SSO,
organisation administration, quotas, queues and external effects remain future work.

## Layout

- `src/verify/`: contracts, synthetic cases, adapters, engine and metrics.
- `src/forge/`: configuration and fixed tool policy.
- `src/api/`: Hono routes, authentication and organisation-scoped SQL.
- `src/ui/`: React workspace.
- `migrations/`: D1-compatible SQL.
- `test/`: engine, API/SQLite and preserved prototype tests.
- `scripts/`: CLI, Node fallback and HTTP smoke check.

[Deployment and separate migration requirements](docs/DEPLOYMENT.md) require
confirmation of the **new Cloudflare account** before any deployment. No deployment
script or workflow is provided. Run `pnpm legacy` for the original prototype.

# API v1 scaffold

All API routes except GET /api/health require a Bearer credential. The server
maps the credential to an organisation, user and role using AUTH_PRINCIPALS.
Client-supplied organisation identifiers are never accepted. There is no CORS
allowlist: use the same-origin UI or a server-side client.

| Method | Path | Body / result |
| --- | --- | --- |
| GET | /api/health | Public liveness only |
| GET | /api/me | Authenticated identity and role |
| POST | /api/verify/suites | {seed:42,count:24}; returns refund-v1 suite |
| POST | /api/verify/runs | {suite,baseline:"policy-v1"}; saves and returns report |
| GET | /api/verify/runs | Last 50 organisation reports |
| GET | /api/verify/runs/:id | Organisation-scoped report, otherwise 404 |
| POST | /api/forge/agents | {name,instructions,adapter,allowedTools}; builder only |
| GET | /api/forge/agents | Last 50 organisation agents |
| POST | /api/forge/agents/:id/evaluate | Suite body; saves agent-linked Verify report |
| POST | /api/forge/agents/:id/execute | {input,tool?}; builder only |
| GET | /api/forge/executions | Last 50 organisation executions |
| POST | /api/forge/executions/:id/review | {approve:true/false}; distinct reviewer only |

Agent adapters: policy-v1, always-approve-v1, always-escalate-v1, http.
Allowed tools: policy.lookup (immediate, read-only), refund.preview (approval,
pure simulation). Tool requests are {name,args:{days:12}}; days may be null.
Each execution permits at most one tool. Tools never run during evaluation.

## Remote model contract

An administrator must set ALLOW_REMOTE_MODELS=true, MODEL_ENDPOINT (trusted
HTTPS URL), MODEL_REVISION (immutable model/prompt revision), and optionally
MODEL_TOKEN. No provider is called by default. The HTTP adapter POSTs:

    {"caseId":"...","input":"...","instructions":"..."}

Return:

    {"decision":"approve","tools":[]}

Decisions are approve, deny, or escalate. Optional tools contains at most one
validated allowlisted request. Unknown fields and malformed outputs fail.
Expected answers are withheld. Requests have a 2-second execution deadline,
response bodies are capped at 64 KiB, redirects are rejected, and no retries
occur. Endpoint configuration is trusted administrator input; do not configure
internal/metadata endpoints. Remote usage may incur provider charges.

Remote batch evaluation is not exposed in the synchronous API (409). The
library evaluate() accepts custom adapters for local use. A bounded asynchronous
queue runner and quota enforcement are prerequisites to hosted remote batches.

## Validation and errors

Bodies are limited to 256 KiB, suites to 100 cases, inputs to 10,000 characters.
400: invalid JSON/schema; 401: missing/invalid credential; 403: denied role/tool;
404: absent or cross-organisation resource; 409: already reviewed or unavailable
batch mode; 413: oversized body; 503: missing auth configuration. Unexpected
errors return generic 500 without provider details or credentials.

Agent configurations are immutable. Create a new agent for each revision.
Approval stores reviewer identity, time and the exact proposal atomically.
Concurrent approval/rejection uses a conditional update: only one can succeed.
External effects are intentionally absent; adding them requires an outbox,
provider idempotency keys, reconciliation and failure recovery.


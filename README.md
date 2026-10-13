# Bolderank Verify

An initial open benchmark workspace for AI agent decisions. Create and import test suites, run an HTTP agent adapter, inspect failures, compare matched runs and export results. Resolve is not included in this release.

## Run

Requires Node 22+. No packages to install.

    npm test
    npm run dev

Open http://127.0.0.1:4173. Deploy `dist/` to Cloudflare Pages (Direct Upload or Git integration with no build command and output directory `dist`).

## Agent contract

The browser POSTs `{ "caseId": "...", "input": "..." }` to your HTTPS endpoint. Return `{ "decision": "approve" }` (or the decision label your suite expects). Expected answers are not sent to the endpoint. Permit the deployed Verify origin via CORS. Each request has a 30-second timeout. Adapter errors and malformed outputs count as failures.

For private endpoints, export a suite and run `node run.mjs suite.json https://your-agent.example/evaluate agent-v1`. Optional bearer credentials are read from the AGENT_TOKEN environment variable. Import the generated results.json into the browser. No secrets are stored by the browser interface. Use an adapter for provider-specific APIs.

## Measurement

Exact string decisions, normalized for case and surrounding whitespace. This does not grade free-text reasoning or semantic equivalence. Pass rate includes all cases, including execution errors. Comparisons require matching case IDs, inputs, and expected decisions. Imports are regraded and identified as self-reported. Latency includes network overhead.

The bundled six-case refund-policy suite and deterministic sample agent are illustrative fixtures, not a validated benchmark or real AI integration. No public leaderboard or independent reliability certification is provided. Exercise real agent endpoints before relying on deployment integration.

## Storage

Suite and the last 40 runs are saved in this browser's local storage. There is no shared backend, user login, or cloud synchronization. Export files for backup and collaboration. Endpoint runs send test inputs to your configured endpoint. Use non-sensitive test cases. Do not commit credentials or private benchmark data.

## Deployment ownership

Requested destination: Bolderank's new Cloudflare account. Existing bolderank.com DNS and Pages deployment are a separate migration and must not be cut over until replacement testing and user approval.

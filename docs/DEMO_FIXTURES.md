# Public fixture catalog

Each fixture is an independently deployable HTTPS MCP service with its own source directory, provider declaration key, source revision, health route, and signed Launch Contract. Production URLs and declaration addresses must be recorded here only after deployment.

| Fixture | Source | Expected Passport | Production URL | Declaration address |
|---|---|---|---|---|
| Healthy | `fixtures/invoice-normalizer-healthy` | all gates pass; paid delivery passes when x402 is enabled | Not deployed | Not deployed |
| Invalid output | `fixtures/invoice-normalizer-invalid-output` | `fresh_challenge: fail`, `invalid_output` | Not deployed | Not deployed |
| Schema drift | `fixtures/invoice-normalizer-schema-drift` | missing `document_id`, `schema_drift` | Not deployed | Not deployed |
| Timeout | `fixtures/invoice-normalizer-timeout` | fresh challenge exceeds deadline, `timeout` | Not deployed | Not deployed |

All demo narration must call these “our public test fixture.” A fixture failure is never presented as a customer failure. Development instances generate an ephemeral declaration key; production startup fails unless `FIXTURE_PROVIDER_PRIVATE_KEY` is explicitly injected.

The healthy service exposes `/mcp` for free non-paid inspection. When `X402_ENABLED=true`, `/paid/mcp` uses the official OKX middleware and a separately configured recipient. Calls with missing, malformed, replayed, wrong-network, or wrong-amount proofs must be rejected by that middleware.

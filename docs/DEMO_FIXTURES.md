# Controlled fixture catalog

Each fixture is an independently signed MCP service with its own source directory, provider declaration key, explicit URL, health route, and Launch Contract. URLs and public declaration addresses are runtime facts written to ignored `.env`; they are not synthesized from a shared base domain or claimed in this tracked document before deployment.

| Fixture | Source | Expected result |
|---|---|---|
| Healthy | `fixtures/invoice-normalizer-healthy` | all five gates pass only when both x402 settlements succeed |
| Invalid output | `fixtures/invoice-normalizer-invalid-output` | fresh challenge fails with `invalid_output` |
| Schema drift | `fixtures/invoice-normalizer-schema-drift` | required `document_id` is absent and classified `schema_drift` |
| Timeout | `fixtures/invoice-normalizer-timeout` | a fresh challenge exceeds its bounded deadline and is classified `timeout` |

All narration must call these “LaunchProof controlled test fixtures.” A controlled failure is never presented as a customer or marketplace-provider failure.

## Identity and provenance

Fixture runtime refuses to start without:

- an explicitly injected private declaration key;
- an explicit `PUBLIC_BASE_URL` origin;
- a 40-character `SOURCE_REVISION` Git commit;
- `XLAYER_CHAIN_ID`, `XLAYER_NETWORK`, and `XLAYER_USDT0_ADDRESS` that agree.

The helper scripts use a different key for every fixture. Stable keys can be generated into ignored mode-0600 `.env`; otherwise local scripts create unprinted, process-scoped keys. Public tunnel startup refuses a dirty worktree and uses the committed HEAD as the signed source revision.

The backend assigns trusted `fixture` status only when both the exact configured URL and matching configured provider address are observed. The manifest's `fixture: true` field alone is untrusted metadata.

## URL modes

- `scripts/start-fixtures-local.sh` uses deterministic URLs `http://127.0.0.1:4101` through `:4104` for integration/development. This mode is local-only and cannot produce verified paid public evidence.
- `scripts/start-fixtures-ngrok.sh` creates four named HTTPS tunnels with one managed agent.
- `scripts/start-fixtures-localtunnel.sh` uses the pinned workspace LocalTunnel package and rejects tunnel interstitials or non-JSON responses.

Public scripts start tunnels first, inject each known URL before signing, cryptographically verify every manifest through its public URL, and export the four URLs/addresses separately.

## Paid healthy resource

The free `/mcp` route supports discovery and bounded rehearsal. When `FIXTURE_X402_ENABLED=true`, `/paid/mcp` uses official OKX middleware with:

- active network `eip155:1952`;
- configured official test USD₮0 asset;
- explicit atomic amount and recipient;
- synchronous settlement confirmation.

Missing, malformed, replayed, wrong-network, wrong-asset, wrong-amount, or wrong-recipient proofs are rejected. Test USD₮0 is explicitly testnet-only and has no monetary value.

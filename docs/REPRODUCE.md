# Reproduce and verify X Layer testnet evidence

Follow [`setup.md`](../setup.md) first. It creates ignored configuration, deploys a fresh registry, records observed deployment metadata, starts four signed fixtures, and validates both RPCs without printing secrets.

Public reproduction requires a clean committed checkout. The run must report:

```text
network=eip155:1952
execution_mode=testnet
payment.status=settled
target_payment.status=settled
chain.published=true
```

Test USD₮0 and test OKB have no monetary value; they must never be described as mainnet or real-value settlement.

## Validate configuration and deployment

```bash
node scripts/validate-demo-env.mjs
```

This read-only command checks source SHA, mode-0600 key/address custody relationships, separated roles, explicit signed fixture identities and contract fields, target-payment caps, live writer/target-payer funding, allowlist, both RPC chain IDs, official test-token bytecode/decimals, facilitator support, registry bytecode hash, and writer. It sends no transaction.

To reproduce registry metadata from the actual deployment transaction:

```bash
forge build --root contracts
pnpm registry:record-testnet -- "$DEPLOY_TX"
```

The helper verifies that the transaction created the locally built registry with the configured writer constructor argument and that code did not exist at the prior block.

## Validate a fixture Launch Contract

Export or substitute only these public values from the validated configuration; do not source the whole application environment into the shell:

```bash
node scripts/verify-fixture-manifest.mjs \
  "$FIXTURE_HEALTHY_URL" \
  "$BUILD_COMMIT_SHA" \
  "$FIXTURE_HEALTHY_URL" \
  healthy \
  eip155:1952 \
  "$XLAYER_USDT0_ADDRESS" \
  x402_optional \
  "$FIXTURE_PAYMENT_RECIPIENT" \
  "$FIXTURE_PAYMENT_AMOUNT_ATOMIC"
```

The verifier checks every field and rejects unknown fields before removing only `declaration_signature`, RFC 8785-canonicalizing the remaining object, SHA-256 hashing its UTF-8 bytes, and verifying the EIP-191 signature against `provider_address`. It checks the exact controlled variant, source, endpoints, sample, assertions, challenge profile, safety claims, payment mode, network, asset, recipient, and atomic amount. The full `node scripts/validate-demo-env.mjs` command performs this verification for all four configured fixture origins.

## Read contract storage directly

Copy the observed public RPC and registry values printed by the setup helpers (or displayed by the project card), then query chain `1952`. Do not source the application `.env` into an interactive shell because it also contains runtime secrets.

```bash
RPC_URL='copy the exact public XLAYER_RPC_URL'
REGISTRY='copy the observed REGISTRY_ADDRESS'
RUN_ID='copy the completed run ID'

cast call "$REGISTRY" \
  'getRun(bytes32)((bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,address,address,uint40,uint16,uint8,bool,bool))' \
  "$RUN_ID" \
  --rpc-url "$RPC_URL" \
  --chain 1952
```

The tuple contains evidence, manifest, input, normalized-result, source-revision, and payment-receipt hashes; previous run ID; provider/writer; timestamp; gate bitmap; status; provider-signature state; and trusted-fixture state.

## Fetch event evidence and recompute

```bash
curl -fsS "$PUBLIC_API_BASE_URL/runs/$RUN_ID" | jq .
curl -fsS "$PUBLIC_API_BASE_URL/verify/$RUN_ID" | jq .
./scripts/verify-run.sh "$RUN_ID"
```

The helper refuses local/unpaid evidence. It requires chain `eip155:1952`, both x402 settlements, all five gates, verified status, a publication transaction, exact event-bytes-to-JCS reserialization, and matching evidence/manifest/input/result/provider/gate/storage/link checks.

For a fully independent decode:

1. Query the `RunPublished` topic from `REGISTRY_DEPLOYMENT_BLOCK`, filtered by indexed `runId` and the exact configured registry.
2. Decode the event with [`schema/registry.abi.json`](../schema/registry.abi.json).
3. SHA-256 the exact decoded `canonicalEvidence` bytes and compare `evidenceHash`.
4. Parse the canonical JSON and RFC 8785/JCS + SHA-256 the manifest signing body, retained inputs, normalized comparisons, and normalized LaunchProof payment reference.
5. Verify the EIP-191 provider signature and compare the gate bitmap/status relationship. A stored `isFixture=true` is invalid unless `providerSignatureVerified=true`.
6. Compare event values to `getRun(runId)` storage.

The canonical payload is sanitized and bounded before publication, but it is permanently public. It must contain only synthetic/public samples and declared fields, never credentials or private customer data.

## Prove cache independence

In an isolated test environment only:

1. Save a successful `/verify/{runId}` response.
2. Stop writers and remove the corresponding PostgreSQL cache row.
3. Request `/verify/{runId}` again.
4. Confirm chain-derived checks remain true while `cache_match` becomes `false` or `null`.

PostgreSQL cannot make chain verification pass. Do not alter a shared/public database merely to demonstrate this property.

## Local-only reproduction

```bash
pnpm fixtures:local
pnpm dev
```

Local fixtures use explicit loopback URLs and may be run without tunnel DNS. Local/unpaid execution is for development only, records local execution/payment state separately from provenance, and is intentionally rejected by the paid testnet verification helper.

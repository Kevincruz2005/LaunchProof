# Reproduce and verify

Set the public values without placing private keys in shell history:

```bash
export PUBLIC_API_BASE_URL=https://api.example
export XLAYER_RPC_URL=https://your-xlayer-rpc
export REGISTRY_ADDRESS=0x...
export REGISTRY_DEPLOYMENT_BLOCK=123456
export RUN_ID=0x...
```

## Validate a Launch Contract

```bash
curl -fsS https://provider.example/.well-known/launch-contract.json \
  | jq -e '.contract_version == "1.0" and .mode == "sample_only" and .challenge_profile.challenge_runs == 3'
node scripts/verify-fixture-manifest.mjs https://healthy.fixtures.example/.well-known/launch-contract.json
```

To reproduce the declaration hash, remove only `declaration_signature`, RFC 8785-canonicalize the complete remaining object, SHA-256 the UTF-8 bytes, then verify an EIP-191 personal signature over the 32-byte hash. The backend implementation is in `backend/src/evidence/canonical.ts` and `backend/src/launch-contract/schema.ts`.

## Read contract storage

```bash
cast call "$REGISTRY_ADDRESS" \
  'getRun(bytes32)((bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,address,address,uint40,uint16,uint8,bool,bool))' \
  "$RUN_ID" --rpc-url "$XLAYER_RPC_URL" --chain 196
```

## Fetch log evidence and recompute hashes

```bash
curl -fsS "$PUBLIC_API_BASE_URL/verify/$RUN_ID" | jq
./scripts/verify-run.sh "$RUN_ID"
```

The script requests the chain-derived verification endpoint, refuses a missing registry record, and requires the evidence, manifest, input, result, provider declaration, gate/status, storage, and link-field checks to match. `cache_match` is reported but cannot affect overall chain `match`.

For a fully independent decode, query the `RunPublished(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,address,address,uint40,uint16,uint8,bool,bool,bytes)` topic from `REGISTRY_DEPLOYMENT_BLOCK`, ABI-decode `canonicalEvidence`, SHA-256 the exact bytes, then JCS/SHA-256 the three embedded hash-material objects.

## Prove cache independence

1. Save a successful `/verify/{runId}` response.
2. Mutate or delete the PostgreSQL row in an isolated maintenance window.
3. Request `/verify/{runId}` again.
4. Confirm all chain-derived checks still pass while `cache_match` changes to `false` or `null`.

On production startup the indexer scans `RunPublished` from `REGISTRY_DEPLOYMENT_BLOCK`, verifies each record from storage and logs, and repopulates runs, normalized invocations, providers, and public payment references. A record that fails chain verification is refused rather than indexed.

## Local apps against real public fixtures

```bash
cp .env.example .env
make demo
```

The demo validates the X Layer/registry/public URL configuration, starts local PostgreSQL/backend/frontend, and prints the rehearsal URL for wallet approval. It does not start fixture mocks or use testnet. Never use unit-test, Anvil, or local-only run IDs in public evidence.

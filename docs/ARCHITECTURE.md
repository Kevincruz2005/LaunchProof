# Architecture

LaunchProof has four independent deployment classes: frontend, backend, immutable registry, and four fixture services. Only JSON schemas and the registry ABI cross the frontend/backend ownership boundary.

## Trust and data flow

The buyer authorizes a fixed-price LaunchProof payment on `eip155:196`. Official OKX x402 middleware verifies and settles the charge before dispatch. The backend then fetches one caller-supplied Launch Contract, performs a bounded MCP rehearsal, normalizes the result, and publishes it through `LaunchProofRegistry`. PostgreSQL indexes the same result for fast reads; `/verify/{runId}` treats the registry log as authoritative.

The writer key cannot change or delete a record. It can only append a unique run ID. Contract storage keeps critical hashes and status; the `RunPublished` event keeps the complete bounded canonical evidence bytes. Provider declarations are EIP-191 signatures over a SHA-256 RFC 8785 manifest hash and are verified again by the registry when supplied. At backend startup, the indexer verifies those records and can rebuild the PostgreSQL runs, invocations, providers, and payment references from chain evidence.

## Run state machine

```text
payment_required -> payment_settled -> queued -> fetching_contract
-> discovering -> fixed_sample -> invalid_input -> fresh_challenges
-> target_payment_or_not_tested -> canonicalizing
-> publishing_on_chain -> complete
```

Infrastructure failures enter `failed`. When a validated manifest provides enough context, the worker attempts a normalized `not-rehearsable` publication. Local-only developer executions terminate as `complete_local` and are visibly excluded from public/mainnet claims.

## Hash material

1. JCS of fixed, invalid, and fresh inputs → `input_hash`.
2. JCS of normalized field comparisons → `normalized_result_hash`.
3. JCS of the complete manifest without `declaration_signature` → `manifest_hash`.
4. JCS of retained canonical evidence → `evidence_hash`.

All four hashes use SHA-256. On-chain evidence is capped at 65,536 bytes in both the worker and contract.

## Operational release order

1. Build/test the registry and copy its generated ABI into `schema/`.
2. Deploy and verify the registry on X Layer mainnet.
3. Deploy and sign the four fixtures on distinct public HTTPS hostnames.
4. Run the PostgreSQL migration; deploy the backend/indexer.
5. Deploy the frontend with public-only chain/API configuration.
6. Verify free `200`, paid `402`, settlement, registry readback, and browser reconstruction.
7. Publish the real project card and listing values from one immutable source commit.

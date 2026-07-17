# Architecture

LaunchProof has four independently deployable classes: frontend, backend/indexer, immutable registry, and four controlled fixture services. The frontend receives only `NEXT_PUBLIC_*` configuration and the backend project card; JSON schemas and the generated registry ABI are the versioned interface boundary.

## Trust and data flow

The supported public profile is X Layer testnet chain `1952`, CAIP-2 network `eip155:1952`, and the official six-decimal test USD₮0 contract configured through `XLAYER_USDT0_ADDRESS`. The browser authorizes a fixed test-token LaunchProof payment. Official OKX x402 middleware verifies and settles it before the worker executes. Discovery messages are not billable work.

The worker fetches one caller-supplied Launch Contract, validates its active network/asset policy, performs a bounded MCP rehearsal, optionally settles one allowlisted target-delivery payment, sanitizes and canonicalizes retained evidence, then publishes through `LaunchProofRegistry`. PostgreSQL indexes the same result for fast reads; `/verify/{runId}` treats registry storage and the `RunPublished` log as authoritative.

The registry writer cannot change or delete a record. It can append only a previously unused bytes32 run ID. Storage retains critical hashes and status; `RunPublished` retains the bounded canonical evidence bytes. Provider declarations are EIP-191 signatures over the SHA-256 RFC 8785 manifest hash and are verified again by the registry when present. The contract rejects `isFixture=true` unless that provider signature verifies.

## Startup chain identity

Chain publication is fail-closed. Startup verifies:

- the configured RPC chain ID;
- bytecode at `REGISTRY_ADDRESS` at and after `REGISTRY_DEPLOYMENT_BLOCK`, with none at the preceding block;
- `keccak256` of live runtime code against `REGISTRY_RUNTIME_CODE_HASH`;
- immutable `writer()` against the configured writer key;
- `MAX_EVIDENCE_BYTES()` against `65536`;
- distinct writer, target-payer, and payout roles;
- configured USD₮0 code and six decimals when x402 is enabled;
- facilitator support for exact settlement on the active CAIP-2 network.

The deployment recording helper additionally matches the deployment transaction's CREATE input to the locally built Foundry creation bytecode plus the expected writer constructor argument. Public address, block, and bytecode hash values are observed rather than copied from documentation.

## Run state machine

```text
payment_required -> settlement_claimed -> payment_settled -> queued -> fetching_contract
-> discovering -> fixed_sample -> invalid_input -> fresh_challenges
-> target_payment_or_not_tested -> canonicalizing
-> publishing_on_chain -> complete
```

`settlement_claimed` is a short durable capacity lease created after x402 verification and before settlement. If the facilitator returns a transaction before final chain verification, the exact transaction/payer/amount/route candidate is persisted as `payment_ambiguous`; startup reconciles only that candidate. A confirmed revert returns to `payment_required`, a proven transfer advances to `payment_settled`, and a missing or pending transaction remains blocked to prevent double charging.

Infrastructure failures enter `failed`. When a validated manifest provides enough bounded context, the worker can publish normalized `not-rehearsable` evidence. Publication also persists the exact canonical candidate and transaction before receipt waiting; startup never replaces a pending/unknown transaction and retries only after a confirmed revert. Explicit developer bypasses produce local-only evidence; they are never a verified paid Passport.

## Identity and labels

- `fixture` requires an exact configured fixture URL and its matching configured provider signature address.
- `external` is an independently supplied public provider.
- `execution_mode` independently records `local`, `testnet`, or `mainnet`; `network` records the CAIP-2 value and payment records carry settlement state.

The label records provenance only. Local execution is never encoded as a service identity label.

A manifest's caller-controlled `fixture` boolean cannot grant trusted fixture status.

## Gates and status

Two bits encode each gate: `not_tested`, `pass`, or `fail`; the fourth bit pattern is rejected. The five gates are `discoverable`, `contract_correct`, `fresh_challenge`, `safe_to_rehearse`, and `paid_delivery`.

`Verified` is valid only when all five gates pass. Tested failures or unpaid delivery produce `NeedsAttention`; incomplete core testing produces `NotRehearsable`. The Solidity contract enforces the same relationship as the backend.

## Evidence and privacy

Before evidence reaches PostgreSQL or the immutable event:

- tool output is reduced to declared assertion/challenge fields;
- discovery identity is reduced to bounded public server fields;
- sensitive key names, bearer values, tokens, JWTs, and secret-like error text are redacted;
- strings, arrays, objects, keys, and nesting depth are capped;
- structured errors are bounded and sanitized;
- raw HTTP bodies, headers, cookies, credentials, and arbitrary undeclared output are not retained.

This is defense in depth, not permission to submit secrets. Targets must use synthetic/public sample inputs only because canonical evidence is permanently public.

## Hash material

1. JCS of retained fixed, invalid, and fresh inputs → `input_hash`.
2. JCS of normalized field comparisons → `normalized_result_hash`.
3. JCS of the complete manifest without `declaration_signature` → `manifest_hash`.
4. JCS of retained canonical evidence → `evidence_hash`.
5. JCS of the normalized LaunchProof payment reference → `paymentReceiptHash` in registry storage/event; the target reference remains covered by `evidence_hash`.

All evidence hashes use SHA-256. Runtime bytecode identity uses Keccak-256. Canonical evidence is capped at 65,536 bytes in both worker and contract.

## Testnet release order

1. Commit the exact source; install the pinned toolchain and run application/contract tests.
2. Build the registry with Foundry and deploy a fresh registry to chain `1952` using a fresh writer.
3. Record and verify deployment transaction input, address, block, runtime hash, writer, and evidence limit.
4. Deploy/sign four fixtures with distinct keys and four explicit HTTPS URLs from that same source commit.
5. Apply PostgreSQL migrations and start the backend so startup preflight succeeds.
6. Build the frontend with public-only testnet/API values.
7. Verify free reads, inbound `402`, both settlements, five passing gates, registry readback, and browser reconstruction.
8. Publish demo/listing references only after those exact public facts exist.

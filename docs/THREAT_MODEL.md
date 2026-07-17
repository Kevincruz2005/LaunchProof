# Threat model

## In scope

- SSRF through manifest, MCP, payment-resource, or redirect URLs.
- DNS rebinding and IPv4-mapped IPv6 bypasses.
- Oversized/slow responses and concurrency exhaustion.
- Schema drift, wrong values, unsafe invalid-input behavior, and target timeouts.
- Payment proof absence, malformed proof, replay, wrong network/asset/amount/recipient/resource, unconfirmed settlement, and unlinked delivery.
- Provider-signature confusion and malleable ECDSA signatures.
- Registry impostors, wrong chain, wrong deployment block, compromised writer configuration, and bytecode substitution.
- Evidence/database mutation, duplicate run publication, payment-ID or settlement reuse, and raw payload leakage.
- Caller-controlled fixture labels or renewal links crossing provider/service/tool identity.
- Untrusted target strings reaching logs, SQL, shells, browsers, or HTML.

## Network and deployment controls

- Public operation is testnet-only: `XLAYER_TESTNET=true`, `ALLOW_XLAYER_MAINNET=false`, chain ID `1952`, and network `eip155:1952`.
- Backend, fixtures, schemas, x402 policy, browser, and project card share one typed runtime chain profile.
- Startup validates both RPC identity and the configured official test USD₮0 code/decimals when payment is enabled.
- Registry preflight proves deployment block boundaries, immutable writer, evidence-size constant, and Keccak runtime-code hash.
- Deployment recording also matches CREATE input to locally built Foundry bytecode plus the expected writer constructor argument.
- Registry writer, target payer, payout, deployer, and four fixture providers use separate fresh keys. No private key has a `NEXT_PUBLIC_` name.

## Fetch and execution controls

- Public targets require HTTPS; credentials and unusual ports are rejected.
- Every connection resolves A/AAAA records, rejects non-global address ranges, pins a validated address while retaining hostname TLS validation, and revalidates at most three redirects.
- Private/local targets and unpaid runs require explicit development flags; both flags are rejected for public/production operation.
- Each response is capped at 1 MB, each call uses a deadline, canonical evidence is capped at 64 KiB, and target calls never retry automatically.
- Requests carry no target credentials, cookies, developer authorization, files, browser state, or undeclared tool access.
- Launch Contract strings, arrays, assertion rules, primitive values, source commits, and challenge schema are bounded and validated. Only `equals`, `gte`, and `lte` assertions are accepted; no manifest-controlled regular expression is executed.
- Renewal lineage must retain the same target/provider/service/tool identity and change the intended source/manifest lineage.

## Payment controls

- Discovery (`initialize`, `tools/list`) is separate from billable tool dispatch.
- Browser policy checks exact scheme, CAIP-2 network, test USD₮0 asset, atomic amount, payout recipient, and route before authorizing.
- Inbound settlement requires a successful facilitator response; a hash-shaped value alone is not settlement proof.
- Target payment requires a verified provider declaration, exact active network/asset terms, an explicit hostname allowlist, one-shot delivery linkage, and per-run/daily payer caps.
- Payment references use explicit `amount_atomic`, `amount_display`, and `asset_decimals`; legacy `amount` is only the atomic compatibility alias.
- Settlement transaction hashes are unique in persistence and cannot be reassigned to another payment/run.
- `Verified` requires all five gates, including `paid_delivery=pass`. Unpaid, `not_tested`, failed, or local-only delivery cannot become verified.

## Evidence minimization and privacy

- Raw response bodies and headers remain only in bounded parser memory and are not written to evidence or logs.
- Stored output is reduced to fields declared by assertions or the challenge profile.
- Server identity, structured errors, comparison values, and remediation text are bounded and sanitized.
- Sensitive property names, bearer tokens, secret-like assignments, JWTs, and private-key-shaped values are redacted.
- Object key counts, array lengths, string lengths, and nesting depth are capped before persistence/publication.
- Canonical results are deterministic. No LLM participates in execution, gate calculation, status, payment, remediation, or hashed evidence.

Sanitization cannot make private customer data safe for a permanent public chain. LaunchProof accepts only synthetic/public sample inputs; operators must inspect manifests and evidence fields before publication.

## Registry and verification controls

- Run IDs are nonzero bytes32 values and write-once.
- The registry recomputes SHA-256 evidence hash, validates provider signature, rejects `isFixture=true` without a verified declaration, enforces gate/status invariants, and records the actual writer/timestamp.
- Trusted fixture state comes from exact configured URL plus provider identity, not a manifest boolean.
- PostgreSQL is a rebuildable index/cache and cannot override storage/event verification.
- Read paths use indexed `runId` events and configured deployment boundaries rather than trusting a frontend label or synthesized explorer link.

## Explicit exclusions

LaunchProof does not accept private/authenticated targets, arbitrary browser automation, file uploads, writes, arbitrary code, target-initiated wallet signing, subscriptions, continuous monitoring, or security/vulnerability certification. It tests only caller-supplied consenting endpoints and controlled fixtures; it never crawls or ranks providers.

## Claims boundary

The registry proves that its immutable writer published specific canonical evidence at a specific X Layer testnet time. It does not prove HTTP execution happened in consensus and does not make LaunchProof a decentralized oracle. A Passport is point-in-time operational evidence, not a future guarantee, mainnet settlement, marketplace identity check, or OKX endorsement. Test tokens have no monetary value.

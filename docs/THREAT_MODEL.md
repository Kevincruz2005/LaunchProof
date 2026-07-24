# LaunchProof security and threat-model notes

Last evidence review: 2026-07-24. This document describes implemented controls and their limits; it is not a claim of formal verification or a security audit.

## Assets and trust boundaries

The critical assets are the registry writer capability, target-payer budget, x402 authorization/replay state, provider declaration identities, canonical evidence, and the integrity of the X Layer testnet anchors. The browser holds only the user's wallet authority. PostgreSQL holds operational state and is explicitly not proof authority.

The system crosses four main boundaries: untrusted public Launch Contract URLs, paid provider MCP endpoints, the browser wallet/x402 challenge, and X Layer RPC/registry reads. Every public proof claim is rebuilt from registry/event/receipt/bytecode/signature material rather than trusted from a database row.

## Implemented controls

| Threat | Control |
| --- | --- |
| Wrong network or token | Configuration and browser policy accept only X Layer testnet `1952` / `eip155:1952` and official test USD₮0 with six decimals. Mainnet is rejected. |
| Registry impostor or code substitution | Startup verifies chain ID, deployment block boundary, runtime-code hash, immutable writer, and evidence limit. Verifiers repeat registry/runtime checks. |
| SSRF, DNS rebinding, redirect abuse | Public HTTPS-only inputs, DNS resolution and non-global-address rejection, address pinning with hostname TLS, restricted redirects, bounded responses/timeouts, and a narrow outbound-header allowlist. |
| Provider declaration forgery | Launch Contract schema, JCS/SHA-256 manifest hash, EIP-191 provider signature recovery, configured provider identity, and same-origin/current-contract checks. A caller-provided `fixture` flag never establishes trust. |
| Payment substitution or replay | Exact network/asset/amount/payer/recipient/resource checks, unique persistence bindings, capped target spending, one-shot delivery linkage, receipt success and timestamp verification, and no automatic retry when the chain outcome is ambiguous. |
| Double writer/publication | One backend replica plus a PostgreSQL session advisory leadership lease and monotonic fence. The read-only mode lacks a lease factory and rejects every writer capability. |
| Cache tampering | Registry storage/event agreement, canonical JCS/hash recomputation, receipt/runtime/provider-signature reconstruction, and explicit database/chain agreement. Cache disagreement blocks a decision. |
| Oversized/secret-bearing evidence | Bounded parser and evidence limits; field reduction; redaction of secret-like names/values; caps on strings, arrays, objects, and nesting; no raw headers/cookies/bodies in public evidence. |
| Unsafe UI/configuration | Public configuration is validated at build/runtime, CORS is exact-origin rather than wildcard, and frontend configuration contains no signing material. |

## Decision failure safety

PassportGate uses an explicit non-decision state for dependency failures. RPC timeout, rate limiting, index outage, contract-fetch outage, or internal verification outage returns `UNAVAILABLE` with `decision: null`; it cannot silently become `ALLOW`, `WARN`, `BLOCK`, or an automatic payment.

A missing, stale, or identity-mismatched Passport returns `REHEARSAL_REQUIRED` with a non-executing link. The link says that explicit payment approval is required; PassportGate never initiates a rehearsal.

## Read-only deployment boundary

`BACKEND_MODE=read-only` rejects x402, registry/target private keys, facilitator credentials, leadership settings, and local/private execution bypasses. It constructs `ReadOnlyLeaderGuard` before a leadership-session factory can exist, skips recovery/indexer loops, omits payment middleware, exposes read-only verification routes, and rejects repository writes. The candidate database role is restricted to SELECT.

## Residual risks and exclusions

- A valid Passport is point-in-time evidence, not future uptime, code, ownership, or security assurance.
- The registry attests to data published by its configured writer; it does not execute or prove remote HTTP/MCP behaviour in consensus.
- A compromised writer, provider key, facilitator, RPC, wallet, or cloud identity remains a material risk despite role separation and verification.
- The project accepts only public/synthetic sample inputs. Sanitization lowers accidental disclosure risk but cannot make private customer data suitable for permanent public publication.
- The controlled failure fixtures are demonstrations, not findings against third-party providers.
- The system is X Layer testnet-only and test tokens have no monetary value.

For the complete live evidence and transaction receipts, see [LIVE_TESTNET_EVIDENCE.md](./LIVE_TESTNET_EVIDENCE.md). For operational rollback, see [AZURE_DEPLOYMENT_AND_ROLLBACK.md](./AZURE_DEPLOYMENT_AND_ROLLBACK.md).

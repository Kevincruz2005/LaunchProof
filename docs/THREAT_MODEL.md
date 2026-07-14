# Threat model

## In scope

- SSRF through manifest, MCP, payment-resource, or redirect URLs.
- DNS rebinding and IPv4-mapped IPv6 bypasses.
- Oversized/slow responses and concurrency exhaustion.
- Schema drift, wrong values, unsafe invalid-input behavior, and target timeouts.
- Payment proof absence, malformed proof, replay, wrong network/asset/amount/recipient/resource, and unlinked delivery.
- Provider-signature confusion and malleable ECDSA signatures.
- Evidence/database mutation, duplicate run publication, and raw payload leakage.
- Untrusted target strings reaching prompts, logs, SQL, shells, browsers, or HTML.

## Controls

- HTTPS only; credentials and unusual ports are rejected.
- Every connection resolves A/AAAA records, rejects non-global address ranges, and pins a validated address while preserving hostname TLS validation. Redirects are revalidated and capped at three.
- Each response is capped at 1 MB, each call uses the declared deadline, evidence is capped at 64 KiB, and target calls never retry automatically.
- Requests carry no target credentials, cookies, developer authorization, files, browser state, or undeclared tools.
- Launch Contract strings/arrays/rules/numbers are bounded. Regex patterns are bounded and target strings render only as text/JSON.
- Target payment requires a signed declaration, exact X Layer/USDT0 terms, a hostname allowlist, and per-run/daily wallet caps. Official OKX SDKs perform payment creation and settlement verification.
- Registry and payout wallets are separate. The target payer is separately budgeted. No private key uses a `NEXT_PUBLIC_` name.
- Canonical results are deterministic. No LLM participates in execution, gate calculation, status, payment, remediation, or hashed evidence.
- Production raw HTTP bodies remain only in bounded parser memory and are not stored or logged. Public controlled fixture data is the sole retention exception.
- The registry verifies evidence hash, signature, gate/status invariants, writer access, and write-once IDs. PostgreSQL cannot override chain verification.

## Explicit exclusions

LaunchProof does not accept private/authenticated targets, arbitrary browser automation, file uploads, writes, arbitrary code, wallet signing by the target, subscriptions, continuous monitoring, or security/vulnerability certification. It tests only caller-supplied consenting endpoints and controlled fixtures; it never crawls or ranks providers.

## Claims boundary

The registry proves that the immutable writer published specific evidence at a specific X Layer time. It does not prove HTTP execution happened inside consensus and does not make LaunchProof a decentralized oracle. A Passport is point-in-time operational evidence, not a security certification or future guarantee.

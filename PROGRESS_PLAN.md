# LaunchProof Upgrade Progress Plan

- Last updated: 2026-07-20
- Current completed phase: Phase 3
- Next phase: Phase 4, only after review and a new explicit prompt

## Mission and non-negotiable operating rule

Upgrade the existing working LaunchProof system into the strongest feasible, verifiable OKX.AI Genesis Hackathon submission without promising a win and without breaking current behavior.

Production isolation is mandatory. Ordinary engineering must occur on a local feature branch that is not connected to Vercel, Railway, Supabase, or any automatic deployment. Never modify, commit on, merge into, push to, redeploy, or reconfigure a deployed/protected branch or platform unless a later high-risk phase explicitly authorizes that exact action.

## Protected production baseline

| Item | Protected value/state |
|---|---|
| Safe source base | `b538cf8e42687d1a370b3bc12296bd676a73528f` |
| GitHub `main` | same commit; protected |
| Preserved release branch | `release/testnet-hardening-20260717`; same commit; protected |
| Railway API/fixture runtime source | `5fa2c80b3b2370724616ae3d0abc50865a8281af`; protected |
| Quarantined historical branch | `origin/deployment` at `dcf5ca7617d0aba7c820a628292559836b56600f`; never use as a base |
| Vercel production | CLI-deployed frontend at safe source base; no Git link |
| Railway production | Five CLI-deployed services; `sourceRepo=null` |
| Supabase | Operational PostgreSQL/cache; no local source/branch link |
| Registry | Existing X Layer testnet registry; do not redeploy unless a later contract/immutable-writer change requires it |

Pushing any branch triggers GitHub CI. It does not currently auto-deploy the audited Vercel, Railway, or Supabase resources. The upgrade branch must still remain local until explicit approval.

## Phase status

| Phase | Status | Result |
|---|---|---|
| Phase 0 — baseline and deployment-link audit | Complete | Full baseline green; live reads green; documented paid Passport independently verified; deployment isolation mapped |
| Phase 1 — PassportGate decision engine | Complete | Isolated local package implemented; 81 targeted tests and the complete existing regression suite pass |
| Phase 2 — REST and MCP/A2MCP adapters | Complete | One read-only adapter service powers a versioned REST route and `check_service_passport`; schema/contract/integration and full regression suites pass |
| Phase 3 — Frontend Judge Mode | Complete | Configuration-driven `/judge` experience, complete proof states, responsive/accessibility coverage, and full regression suite pass |

## Phase 0 completed work

- Read all applicable repository instructions; no `AGENTS.md` exists.
- Audited README, setup/runbooks, architecture, implementation, threat model, reproduction guide, package scripts, CI, Docker/hosting configuration, backend configuration/preflight, Prisma/migrations, payments, MCP schemas/client, worker, evidence/registry/verifier, frontend routes/wallet, and fixtures.
- Confirmed current branch/commit and clean starting state.
- Installed dependencies with frozen lockfile using verified Node 24.18.0 and pinned pnpm 10.13.1.
- Generated Prisma client.
- Ran the complete application and Solidity baseline.
- Validated committed scripts, JSON, strict draft 2020-12 schemas, Prisma schema, migration SQL generation, contract ABI stability, and final diff.
- Audited Vercel, Railway, Supabase, and GitHub CI/deployment behavior read-only.
- Checked live web/API/fixture endpoints without a paid request.
- Independently verified the documented paid Passport using the public API verifier, local JCS/hash/signature recomputation, direct registry storage/runtime reads, and direct transaction receipts.
- Created only this file and `BASELINE_ACCEPTANCE_REPORT.md`.

Detailed evidence and commands: [`BASELINE_ACCEPTANCE_REPORT.md`](./BASELINE_ACCEPTANCE_REPORT.md).

## Baseline test results

| Check | Result |
|---|---|
| Frozen dependency install | Pass |
| Prisma generation and schema validation | Pass |
| Backend tests | 81/81 pass |
| Frontend tests | 8/8 pass |
| Fixture runtime tests | 7/7 pass |
| Solidity tests | 9/9 pass |
| TypeScript | Pass across all packages |
| Lint | Pass |
| Production builds | Pass |
| Contract compile/ABI consistency | Pass |
| Foundry format/build | Pass |
| Shell/Node script syntax | Pass |
| JSON parsing | Pass |
| Strict JSON Schema compilation | Pass |
| Migration SQL generation | Pass; no database migration applied in read-only Phase 0 |
| Live unpaid endpoints | Pass |
| Existing paid Passport verification | Pass; every verifier flag and aggregate `match` true |
| Final pre-report tracked diff | Clean |

## Verified invariants to preserve in every phase

- X Layer testnet chain ID `1952` and CAIP network `eip155:1952` only.
- Official configured X Layer testnet USD₮0 only: `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c`, six decimals.
- Public/testnet x402 enabled; public local unpaid/private-target bypasses disabled.
- Local, unpaid, partial, mocked, or synthetic-publication runs never become Verified.
- Verified requires all five gates and independently proven launch plus target token settlements.
- PostgreSQL remains queue/cache/recovery storage, never proof authority.
- Registry storage/event data, receipts, bytecode, signatures, and reconstructed evidence determine verification.
- Frontend must contain no secret or private signing material.
- Public runtime anchors must come from validated configuration and fail closed.
- Full immutable 40-character source revisions across backend and fixtures.
- Preserve public routes and fields; prefer additive/versioned changes.
- No fabricated transaction, contract, signature, review, or evidence values.
- Do not redeploy the registry merely because hosting or application code changes.

## Open findings that must shape later phases

1. Add a real cluster-wide leader lease/fencing mechanism for registry writer and payment/publication recovery. Do not rely only on a configured replica count or Railway `numReplicas=1`.
2. Require production frontend public configuration at build/start instead of allowing localhost or missing-anchor fallbacks.
3. Define an immutable release manifest that ties one full Git SHA to every service image tag and digest.
4. Ensure future candidate deployment uses one exact full SHA across Vercel, API, and all four fixtures.
5. Decide in a later approved phase whether and how to clean historical secret-bearing Git objects and old clones; current credentials must remain rotated.
6. Keep live-chain verification manual/non-paying in normal CI, but improve deterministic candidate acceptance without causing paid actions.
7. Record intermittent public fallback-RPC connection resets and keep resilient validated primary/fallback behavior.
8. Configure submission metadata, including the OKX.AI listing URL, only after it exists and only in an explicitly approved release/submission phase.
9. Remove the unused erroneous Vercel `frontend` project only with explicit platform-mutation approval.

## Phase 1 isolated workspace

Created locally after the explicit Phase 1 request:

`upgrade/passportgate-phase1-20260719`

Verified base:

`b538cf8e42687d1a370b3bc12296bd676a73528f`

Rules:

- branch remains local-only with no upstream;
- do not push;
- do not link it to a hosting/database platform;
- do not alter `main`, `release/testnet-hardening-20260717`, or `deployment`;
- do not deploy, migrate a database, sign a wallet action, pay, or change chain state;
- this file and the complete Phase 1 prompt were reread before changes;
- the existing green suite was preserved and targeted tests cover every Phase 1 decision rule;
- work stopped at the Phase 1 acceptance gate.

## Deviations and diagnostic notes

- Host Node 26 was outside the supported engine range, so authoritative checks used a checksum-verified Node 24 binary in `/tmp`.
- The first nested `pnpm check` invocation lacked a `pnpm` executable in `PATH`; a temporary pinned launcher fixed only test setup, and the full check then passed.
- Prisma validation initially lacked a datasource variable; an inert non-connected URL was supplied for parsing only.
- `ajv-cli@5` could not support the schemas' draft; strict compilation was rerun successfully with temporary Ajv 8 plus registered formats.
- No database migration was executed because Phase 0 forbids database modification.
- One fallback RPC call and one GitHub HTTP/2 read needed safe retries; final read results are recorded in the baseline report.
- Phase 1 authoritative checks continued to use the verified Node 24.18.0 binary and pinned pnpm 10.13.1 because host Node 26 remains outside the declared engine range.
- The first property-test run exposed a test-callback return-value mistake after 67 tests passed. The test harness was corrected without weakening any assertion; the subsequent run passed, and the final expanded suite passed all 81 tests.
- The temporary Phase 0/1 Node toolchain had expired before Phase 2. Node 24.18.0 was downloaded again from the official distribution, its archive passed the published SHA-256 check, and pnpm 10.13.1 was activated through that verified runtime.
- The first Phase 2 adapter run found four test-contract issues: two pre-Phase-2 exact tool-list expectations, one MCP strict-object assertion, and one incorrect backward-compatibility expectation. The tests were corrected to preserve old fields while accepting the additive tool. A later run exposed MCP SDK 1.x incompatibility with a Zod v3 union output schema; the MCP metadata was represented as the SDK-supported raw Zod output shape while the exact discriminated contract remains enforced by the published draft 2020-12 JSON Schema. No decision assertion was weakened.

## Open questions

No user input is required to close Phase 3. Later phases may require explicit approval only for interactive authentication, charged infrastructure, testnet funding, browser-wallet signatures, facilitator credentials, registry changes, destructive operations, marketplace approval, posting, or form submission.

## Phase 0 acceptance gate

- [x] No product code/configuration, Git reference, database, contract, wallet, chain state, or deployment changed.
- [x] Only the progress plan and baseline report were written.
- [x] Deployment-linked branches/commits and auto-deploy behavior identified.
- [x] Safe base and proposed local branch recorded.
- [x] Complete baseline suite executed and recorded honestly.
- [x] Existing paid Passport independently verified with no paid action.
- [x] Reports contain no secrets.

## Phase 1 completed work

Phase 1 was performed only on local branch `upgrade/passportgate-phase1-20260719`, created directly from safe base `b538cf8e42687d1a370b3bc12296bd676a73528f`. The branch has no upstream and was not pushed, connected, merged, or deployed. The protected local and remote `main` and `release/testnet-hardening-20260717` refs remained fixed at the safe base.

One authoritative, side-effect-free domain package now exists at `packages/passport-gate`. It is deliberately adapter-independent so later REST, MCP, and frontend work can call the same decision function instead of duplicating policy. No Phase 2 adapter was implemented.

### Domain behavior implemented

- Validates X Layer testnet-only configuration (`1952`, `eip155:1952`), configured token address/decimals, public HTTPS bases, caller freshness thresholds, optional expected provider, and full 40-character source revision.
- Normalizes public Launch Contract URLs and rejects credentials, query/fragment ambiguity, nonstandard ports, localhost, private/reserved literal IPs, and internal/local host suffixes. DNS, redirect, and rebinding checks remain at the trusted safe-fetch adapter boundary; the engine refuses evidence unless that boundary reports success.
- Constructs the exact current contract identity from normalized URL, manifest hash, provider signer, and source revision using JCS and SHA-256.
- Consumes explicit independent proof checks for registry record, JCS/evidence hashes, manifest/input/result hashes, provider signature, identity/revision, registry runtime, registry event/storage agreement, publication transaction, and database/chain agreement.
- Derives settlement semantics from independently reconstructed expected and observed references for both inbound and provider payments, including presence, receipt success, network, configured asset, amount, decimals, payer, recipient, transaction/payment identity, timestamp, and independent verification.
- Uses only the anchored chain block timestamp for age. Exact rules are `age <= warn` → ALLOW, `warn < age <= max` → WARN, and `age > max` → REHEARSAL_REQUIRED after every trust check passes.
- Fails closed to BLOCK for authentic NeedsAttention/NotRehearsable results, any of the five gate failures, any verification/settlement mismatch, invalid anchored timestamp, or database/chain disagreement.
- Returns operational dependency failures as `operational_status: UNAVAILABLE` with `decision: null`; they cannot become BLOCK or ALLOW.
- Returns configuration-built Passport/explorer links and an explicit, non-executing rehearsal or renewal action. The action states that explicit payment approval is required and cannot silently spend.
- Includes stable reason codes and all required identity, freshness, gate, settlement, publication, and hash evidence fields.

### Files added or changed in Phase 1

- `packages/passport-gate/package.json`
- `packages/passport-gate/tsconfig.json`
- `packages/passport-gate/vitest.config.ts`
- `packages/passport-gate/src/index.ts`
- `packages/passport-gate/src/types.ts`
- `packages/passport-gate/src/errors.ts`
- `packages/passport-gate/src/primitives.ts`
- `packages/passport-gate/src/validation.ts`
- `packages/passport-gate/src/engine.ts`
- `packages/passport-gate/test/engine.test.ts`
- `packages/passport-gate/test/properties.test.ts`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `PROGRESS_PLAN.md`

`BASELINE_ACCEPTANCE_REPORT.md` remains the unchanged Phase 0 evidence report.

### Phase 1 decision and property coverage

| Coverage | Verified result |
|---|---|
| ALLOW | Fully verified, all five gates, both exact settlements, age at/below warning threshold |
| WARN | Same complete proof; freshness is the only warning; exact upper maximum remains WARN |
| REHEARSAL_REQUIRED | No exact Passport, changed contract identity, changed source revision, or valid stale Passport; safe action returned |
| BLOCK | Each status/gate/verification/database/settlement failure independently covered |
| UNAVAILABLE | RPC outage, timeout, rate limit, and unavailable index return no trust decision |
| Boundaries | Exact `warn_age_hours` and `max_age_hours` inclusivity covered |
| Properties/fuzz | Sparse gate bitmap, all gate truth rows, complete decision truth table, JCS ordering, hash determinism, URL normalization/rejection, atomic/display amount round trips |

### Phase 1 commands and results

All authoritative Node commands used Node 24.18.0 and pnpm 10.13.1.

```text
git status --short --branch
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717
git branch -vv --no-color
git switch -c upgrade/passportgate-phase1-20260719

pnpm install --lockfile-only
pnpm install --offline
pnpm --filter @launchproof/passport-gate typecheck
pnpm --filter @launchproof/passport-gate test
pnpm --filter @launchproof/passport-gate build
pnpm check

forge fmt --check
forge build
forge test -vvv

git diff --check
git diff --stat
deployment-value/secret-pattern searches limited to the new package
```

Verified results:

- PassportGate: 81/81 tests pass across two files; typecheck, lint, and build pass.
- Existing backend: 81/81 tests pass.
- Existing frontend: 8/8 tests pass and production build succeeds.
- Existing fixture runtime: 7/7 tests pass; all fixture builds/typechecks succeed.
- Existing Solidity: 9/9 tests pass; format/build succeed.
- Root `pnpm check`: pass, including contract ABI consistency, all lint/typecheck/tests/builds.
- Final secret/deployment-value scan: no live endpoint, credential, private key, database URL, registry address, RPC URL, or configured token address was added to product code. Test-only example and rejected private URL values are intentional.

## Phase 1 acceptance gate

- [x] Work occurred only on the isolated, non-deployment-linked local branch.
- [x] No platform, database, contract, wallet, chain state, or live endpoint changed.
- [x] One authoritative PassportGate decision module exists.
- [x] ALLOW/WARN/BLOCK/REHEARSAL_REQUIRED semantics match the Phase 1 specification.
- [x] Operational unavailability cannot become BLOCK or ALLOW.
- [x] Unit/property/fuzz tests pass: 81/81.
- [x] Affected and complete existing tests pass.
- [x] Diff inspection found no regression or hardcoded deployment values.
- [x] This progress plan was updated without secrets.

Phase 1 stopped at its gate. Phase 2 began only after the new explicit Phase 2 prompt.

## Phase 2 completed work

Phase 2 remained on local branch `upgrade/passportgate-phase1-20260719`, which still has no upstream. HEAD and the protected local/remote `main` and `release/testnet-hardening-20260717` refs all remained fixed at safe base `b538cf8e42687d1a370b3bc12296bd676a73528f`. Nothing was committed, pushed, merged, deployed, or connected to a platform.

### REST and MCP/A2MCP surface

- Added versioned, read-only `POST /api/v1/passport-gate/check`.
- Added public MCP/A2MCP-compatible `check_service_passport` on the existing `/mcp/public` transport.
- Both adapters use the same strict Zod input schema, the same transport serializer, the same `PassportGateService`, and ultimately the single authoritative Phase 1 `evaluatePassportGate` function.
- REST returns a domain decision with HTTP 200, or `verification_unavailable` with HTTP 503, `decision: null`, a stable reason code, and `retry_safe: true`.
- MCP returns the semantically identical body as text plus structured content. Unavailability is a typed tool error with the same stable code and no decision.
- The project card advertises the new tool, REST URL, and schema URL additively; the existing `get_service_passport`, compatibility alias, rehearsal tools, and public fields remain.

### Read-only proof reconstruction path

- Current Launch Contracts are normalized and loaded through the existing DNS-resolved, address-pinned, redirect-restricted safe-fetch abstraction.
- The existing Launch Contract parser enforces X Layer testnet payment policy. Manifest hashes are reconstructed with JCS, and provider signatures are independently recovered before the domain module sees the contract proof.
- PostgreSQL/MemoryRepository is used only to discover candidates for the normalized target and provider. A new targeted repository query uses existing indexed run fields and does not require a migration.
- Before absence is trusted, the registry reader proves RPC chain ID, registry bytecode, and configured runtime hash. No cache-only ALLOW path exists.
- Every candidate is reconstructed with the strict registry verifier: registry storage/event agreement, canonical evidence, manifest/input/result hashes, provider signature, link/source identity, runtime bytecode, publication receipt, and both token-transfer receipts/timestamps are independently checked.
- Candidate ordering uses the anchored chain timestamp. Database cache comparison covers canonical evidence, hashes, source/provider, publication state, and transaction identity; disagreement reaches the domain as `databaseChainMatch: false` and fails closed.
- Transport/RPC timeout, rate limit, index outage, contract-fetch outage, or internal reconstruction failure becomes operational unavailability. A missing transaction receipt remains a settlement proof failure rather than being mislabeled as an outage.
- The route/tool never invokes rehearsal reservation, x402 middleware settlement, target payment, registry publication, or any wallet signer. A returned rehearsal/renewal URL remains an explicit non-executing action requiring payment approval.

### Schemas and configuration

- Added `schema/passport-gate.schema.json`, a strict draft 2020-12 contract for input, every decision output field, and the exact unavailability envelope.
- Added the REST operation and schema route to `schema/openapi.json`.
- Added MCP input and output tool metadata, including structured output fields.
- Added validated `PASSPORT_GATE_WARN_AGE_HOURS` and `PASSPORT_GATE_MAX_AGE_HOURS` deployment defaults; maximum must be greater than warning.
- Extended the Phase 1 configuration model with explicit local mode, permitting output links over HTTP only on loopback hosts. Public mode remains HTTPS-only. Launch Contract inputs remain public HTTPS-only in every mode.
- Tightened Phase 1 EVM identity validation to reject the zero address.

### Files added or changed in Phase 2

- `.env.example`
- `package.json`
- `pnpm-lock.yaml`
- `backend/package.json`
- `backend/src/config.ts`
- `backend/src/passport-gate/service.ts`
- `backend/src/rest/app.ts`
- `backend/src/mcp/server.ts`
- `backend/src/chain/registry.ts`
- `backend/src/db/store.ts`
- `backend/src/db/prisma-store.ts`
- `backend/src/db/logging-store.ts`
- `backend/src/launch-contract/schema.ts`
- `backend/src/workers/rehearsal.ts`
- `backend/test/passport-gate-adapters.test.ts`
- `backend/test/routes.test.ts`
- `backend/test/config.test.ts`
- `schema/passport-gate.schema.json`
- `schema/openapi.json`
- `packages/passport-gate/src/types.ts`
- `packages/passport-gate/src/primitives.ts`
- `packages/passport-gate/src/validation.ts`
- `packages/passport-gate/test/engine.test.ts`
- `packages/passport-gate/test/properties.test.ts`
- `PROGRESS_PLAN.md`

The LaunchProof registry contract, registry ABI, Prisma schema, migrations, frontend, fixtures, wallets, databases, and live endpoints were not changed.

### Phase 2 contract and compatibility coverage

| Coverage | Verified result |
|---|---|
| REST/MCP parity | Text and MCP structured content equal the REST body for ALLOW, WARN, BLOCK, and REHEARSAL_REQUIRED |
| Input parity | Unsafe URL, invalid freshness relationship, invalid provider, and unknown-field inputs are rejected by both adapters |
| Unavailability | REST 503 and MCP typed error share `verification_unavailable`, retry-safe reason, and `decision: null` |
| Real service mapping | Controlled read-only current-contract, index, registry, cache, settlement, and anchored-time proof maps to ALLOW through the production service |
| Operational precedence | Registry timeout returns RPC_TIMEOUT before cache lookup; cache cannot become proof |
| Controlled fixtures | Healthy → ALLOW; invalid-output, schema-drift, and timeout → BLOCK with their exact gate reasons |
| Failure safety | No controlled failure fixture can produce ALLOW |
| Schemas | JSON Schema compiles in strict Ajv 2020 mode and validates representative decision/unavailable bodies; MCP lists input/output metadata |
| Compatibility | Existing paid rehearsal still returns the same 402 fields; old REST paths, MCP tools/alias, and project-card fields remain |
| Side effects | Tests use controlled read-only dependencies; no payment, signer, publication, database migration, live RPC, or chain write occurs |

### Phase 2 commands and results

Authoritative Node commands used checksum-verified Node 24.18.0 and pinned pnpm 10.13.1.

```text
official Node 24.18.0 SHASUMS256.txt and archive download
sha256sum --check --strict node-v24.18.0-linux-x64.tar.xz
corepack prepare/enable pnpm@10.13.1

git status --short --branch
git branch -vv --no-color
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717

pnpm install --lockfile-only
pnpm install --offline
pnpm --filter @launchproof/passport-gate build
pnpm --filter @launchproof/passport-gate typecheck
pnpm --filter @launchproof/passport-gate test
pnpm --filter @launchproof/backend typecheck
pnpm --filter @launchproof/backend test
pnpm --filter @launchproof/backend exec vitest run test/passport-gate-adapters.test.ts
pnpm check

jq empty schema/openapi.json schema/passport-gate.schema.json
git diff --check
git diff --exit-code -- contracts/src/LaunchProofRegistry.sol contracts/test/LaunchProofRegistry.t.sol schema/registry.abi.json
secret/deployment-value, skipped-test, conflict-marker, and whitespace scans over Phase 2 files
```

Final verified results:

- PassportGate domain: 83/83 tests pass across two files; typecheck, lint, and build pass.
- Backend: 100/100 tests pass across thirteen files, including 18 Phase 2 adapter/service/schema tests; typecheck and build pass.
- Frontend: unchanged; 8/8 tests, lint, typecheck, and production build pass.
- Fixture runtime: unchanged; 7/7 tests and all fixture typechecks/builds pass.
- Root `pnpm check`: pass, including contract compilation/ABI consistency, all workspace lint/typecheck/tests/builds.
- Registry Solidity source/test and generated ABI diff: unchanged.
- Final branch/ref and secret/diff audit: pass.

## Phase 2 acceptance gate

- [x] Work remained on the isolated non-deployment branch.
- [x] No external platform, live database, chain, payment, wallet, or deployment changed.
- [x] REST and `check_service_passport` use the same authoritative domain module.
- [x] JSON, OpenAPI, MCP input, and MCP output schemas are documented and validated.
- [x] Contract tests prove REST/MCP semantic equivalence for every decision.
- [x] HTTP 503 and MCP unavailability never produce a trust decision.
- [x] Controlled fixture and backward-compatibility tests pass.
- [x] Affected and complete existing tests pass; diff inspection found no regression.
- [x] This progress plan was updated without secrets.

Phase 2 stops here. No Judge Mode, frontend change, broad security phase, writer-leadership change, cloud resource, deployment, live transaction, or Phase 3 work was performed. Do not begin Phase 3 without a new explicit prompt.

## Phase 3 completed work

Phase 3 remained on local branch `upgrade/passportgate-phase1-20260719`. The branch still has no upstream and was not committed, pushed, merged, linked, previewed, or deployed. HEAD and all protected local/remote `main` and `release/testnet-hardening-20260717` refs remained at safe base `b538cf8e42687d1a370b3bc12296bd676a73528f`. No live API, fixture, Vercel, Railway, Supabase, database, wallet, payment, contract, RPC, or chain state was modified.

Before frontend work began, the Phase 1 engine reran at 83/83 and the Phase 2 REST/MCP adapter contract suite reran at 18/18. Judge Mode uses the real local Phase 2 REST contract; controlled responses and wallet states are mocked only inside frontend tests and are never presented as public evidence.

### Judge Mode product behavior

- Added the additive `/judge` route and a visible Judge Mode navigation/landing-page entry point without removing any existing route or flow.
- Leads with: “Before an AI agent hires an ASP, ask for its LaunchProof Passport.” The first screen clearly labels the read-only trust gate and X Layer Testnet.
- Loads the fixture catalog from `GET /fixtures`, selects the configured `healthy` fixture by variant, and prefills its backend-provided Launch Contract URL. It refuses to substitute or hardcode a URL when no healthy fixture is configured.
- Sends the one primary `Check Service Passport` action to `POST /api/v1/passport-gate/check`. It never requests a wallet, signature, payment, rehearsal, or chain write.
- Validates the catalog and PassportGate response at runtime. A malformed HTTP 200 fails closed with “No decision made”; a typed HTTP 503 stays `UNAVAILABLE` with `decision: null` and is never displayed as BLOCK or ALLOW.
- Presents ALLOW, WARN, BLOCK, and REHEARSAL REQUIRED as large decisions with freshness/age, explanation, and stable reason information.
- Always presents all five named gate positions. Missing Passport evidence is labeled `not available`, never passed or verified.
- Presents both settlement transactions and the evidence-publication transaction with hashes and configuration-built explorer links. Missing or unverified transactions are explicitly labeled `Not verified`.
- Shows independent-verification and database/chain-agreement state separately; no database-only result is labeled independently verified.
- Provides expandable identity, hash, settlement, publication, and reason-code evidence.
- Provides a copy/share Passport action only when the backend returns a real Passport URL. REHEARSAL_REQUIRED/WARN actions use the backend-provided rehearsal/renewal URL and preserve explicit-payment approval semantics.
- Adds catalog-loading, proof-loading, initial-empty, catalog-empty, typed-unavailable, malformed/fetch failure, wallet-absent, wrong-network, wallet-rejection, and payment-rejection coverage. The read-only Judge check explicitly explains that a wallet is not required.
- The existing header wallet control now renders its previously hidden rejection/configuration error as a screen-reader alert. It does not change wallet connection, persistence, disconnect, signing, or payment behavior.
- Centralized `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WEB_BASE_URL` validation. Non-test builds require both values; HTTPS is required outside loopback, and credentials/query/fragment values are rejected. The Judge implementation contains no fixture URL, explorer base, registry address, or other deployment target.
- No embeddable status badge endpoint was added. It was optional, and omitting it avoids any possibility of presenting database-only state as Verified.

### Responsive and accessibility behavior

- Desktop uses a two-pane check/result console; breakpoints collapse it to one column, preserve all decision/evidence/actions, and reduce the five-gate and transaction grids to mobile-safe single columns at 440 px.
- A component test exercises the full WARN evidence view at a 390 px viewport, and a stylesheet contract test covers the 1050 px and 440 px Judge breakpoints.
- All controls have labels, keyboard semantics, visible `:focus-visible` indicators, status/alert live regions, descriptive external-transaction labels, reduced-motion support, and programmatic focus movement to a completed decision.
- Axe found zero semantic/accessibility violations. JSDOM cannot calculate CSS color contrast, so that Axe rule was disabled only in the component test; independent WCAG luminance calculations covered Judge text, status badges, primary action, body text, unavailable text, and focus indicator. Ratios ranged from 4.79:1 to 7.77:1, meeting normal-text AA and focus-indicator contrast.

### Files added or changed in Phase 3

- `frontend/app/judge/page.tsx`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/components/judge-mode.tsx`
- `frontend/components/wallet-control.tsx`
- `frontend/lib/generated-api/client.ts`
- `frontend/lib/public-config.ts`
- `frontend/test/judge-mode.test.tsx`
- `frontend/test/judge-client.test.ts`
- `frontend/test/rehearsal-errors.test.tsx`
- `frontend/test/public-config.test.ts`
- `frontend/test/payment-policy.test.ts`
- `frontend/vitest.config.ts`
- `frontend/package.json`
- `pnpm-lock.yaml`
- `PROGRESS_PLAN.md`

No backend adapter/domain logic, database schema/migration, fixture implementation, registry contract/test/ABI, wallet signer, payment policy, or live configuration was changed in Phase 3.

### Phase 3 commands and results

Authoritative Node commands used checksum-verified Node 24.18.0 and pnpm 10.13.1. Foundry 1.7.1 was downloaded temporarily from the official immutable GitHub release after the prior temporary binary was no longer present; its release SHA-256 file verified the archive before use.

```text
git branch --show-current
git branch -vv --no-color
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}

pnpm --filter @launchproof/passport-gate test
pnpm --filter @launchproof/backend exec vitest run test/passport-gate-adapters.test.ts
pnpm install --lockfile-only
pnpm install
pnpm --filter @launchproof/frontend exec vitest run test/judge-mode.test.tsx test/judge-client.test.ts test/payment-policy.test.ts test/rehearsal-errors.test.tsx
pnpm --filter @launchproof/frontend typecheck
pnpm --filter @launchproof/frontend test
pnpm --filter @launchproof/frontend lint
pnpm --filter @launchproof/frontend build
pnpm check

curl local production server /judge and /
WCAG relative-luminance calculations over Judge Mode foreground/background pairs
forge fmt --check
forge build
forge test -vvv

git diff --check
git diff --exit-code -- contracts/src/LaunchProofRegistry.sol contracts/test/LaunchProofRegistry.t.sol schema/registry.abi.json
hardcoded deployment value, secret, skipped-test, conflict-marker, and whitespace scans over Phase 3 files
```

Final verified results:

- Phase 1 PassportGate domain prerequisite: 83/83 pass.
- Phase 2 adapter prerequisite: 18/18 pass.
- Frontend: 28/28 pass across five files, including all four decisions, typed 503, invalid response, dynamic fixture catalog, mobile, accessibility, wallet absent/rejection/wrong chain, and payment rejection; typecheck and lint pass.
- Backend: 100/100 pass across thirteen files.
- Fixture runtime: 7/7 pass; every fixture typecheck/build passes.
- Solidity: 9/9 pass; format/build pass; registry source/test/generated ABI remain unchanged.
- Root `pnpm check`: pass, including contract compile/ABI consistency, every workspace lint/typecheck/test/build, and the warning-free Next.js production build.
- Production frontend build includes static `/judge` at 3.74 kB route size. A local production server returned HTTP 200 for `/judge` and `/`, and rendered their expected server content.
- Final dependency/config/source scans found no Phase 3 secret or hardcoded fixture/deployment endpoint.

### Iteration notes and deviations

- The offline-only dependency install lacked one test-only tarball; a normal package-manager install fetched the locked frontend test dependencies. No application runtime dependency, endpoint, or external platform changed.
- Early targeted tests exposed classic JSX transform behavior in Vitest; an explicit automatic-JSX Vitest configuration fixed the harness without changing production rendering.
- Early assertions over-counted repeated `not available` text and all page links; selectors were narrowed to the named gates and configured explorer links without weakening product assertions.
- Existing header wallet errors were not visible in header placement. The new component test exposed this and the UI now renders the existing error state accessibly.
- The first production CSS build warned about the partially supported `align-items: end`; it was changed to `flex-end`, and final builds are warning-free.
- The optional badge endpoint was intentionally not implemented because Phase 3 had no need for it and a proof-derived badge contract would expand scope.

## Phase 3 acceptance gate

- [x] Work remained on the isolated non-deployment branch.
- [x] No live platform, database, wallet, payment, contract, endpoint, or chain state changed.
- [x] Judge Mode communicates the product and primary action on its first screen.
- [x] Every required decision, evidence field, and operational/UI state is represented honestly.
- [x] No deployment or fixture URL is hardcoded in Phase 3 product code.
- [x] Mocked wallet/transaction values exist only in local tests and are never public proof.
- [x] Frontend, 390 px mobile, keyboard, Axe accessibility, contrast, wallet, payment-rejection, and existing-flow tests pass.
- [x] Production frontend build, full root regression, and Solidity tests pass.
- [x] `PROGRESS_PLAN.md` was updated without secrets.

Phase 3 stops here. No security-hardening phase, writer-leadership change, Azure resource, deployment, live transaction, or Phase 4 work was performed. Do not begin Phase 4 without a new explicit prompt.

## Phase 4 completed work

Phase 4 remained on local branch `upgrade/passportgate-phase1-20260719`. The branch has no upstream. HEAD and the protected local/remote `main` and `release/testnet-hardening-20260717` refs remained at `b538cf8e42687d1a370b3bc12296bd676a73528f`. Nothing was committed, pushed, merged, previewed, or deployed. No Vercel, Railway, Supabase, database, wallet, facilitator, contract, RPC endpoint, fixture endpoint, or chain state was changed.

Before hardening began, the Phase 1 domain suite passed 83/83, the Phase 2 adapter suite passed 18/18, and the Phase 3 frontend suite passed 28/28. Phase 4 then used only local source, synthetic test constants, in-memory repositories, and existing build tools.

### Searches and findings

Repository-wide searches covered chain/network literals, addresses, URLs, mainnet imports/fallbacks, development defaults, placeholder credentials, `local_only`, the public unpaid header, generated fixture keys, mock/fake transaction identifiers, private-key/token/database URL patterns, skipped tests, conflict markers, sensitive filenames in current refs and Git object paths, container definitions, and all configuration readers.

Findings and disposition:

- The backend correctly rejected mainnet in configuration, but chain preflight and inbound settlement verification still imported a dormant X Layer mainnet fallback. Both fallback paths were removed; those clients now explicitly refuse anything except chain 1952 / `eip155:1952` and instantiate only `xLayerTestnet`.
- Production configuration inherited safe testnet constants when explicit chain/network/asset/explorer variables were absent, accepted placeholder/local service values in several fields, did not require an immutable image identity, and accepted weak repeated-byte development keys. Production now requires all security-critical chain and public values explicitly, checks public HTTPS/origin shape, placeholder/local hosts, PostgreSQL shape, credential quality, role separation, exact commit/image tag, and immutable digest before startup can become ready.
- The frontend validated only its API and web bases. It now validates all public chain anchors, RPC, registry, payout, deployment block, source repository, public origins, mainnet/unknown-chain refusal, placeholder/local refusal, and distinct nonzero roles before a non-test build can succeed.
- CORS accepted the response-only `access-control-expose-headers` name as a request header and advertised the local unpaid header even when the bypass was disabled. Both were removed. The local header is advertised only by an explicitly local unpaid service; denied origins return 403; API security headers and request IDs are applied before CORS.
- Safe fetch pinned a DNS result and revalidated redirects already, but caller headers were not allowlisted and fixture tunnel headers were scoped by hostname rather than exact origin. Outbound headers now use a small MCP/x402 allowlist, reject credential/proxy/host/CORS/framing headers and control characters, and tunnel headers require an exact configured origin.
- SSRF hostname checks now normalize a trailing dot and explicitly reject localhost subdomains, `.local`, `.internal`, `.home.arpa`, metadata/link-local targets, mapped IPv4, alternate numeric IPv4 forms, unspecified, benchmark, multicast, broadcast, private, reserved, and documentation ranges. Redirects remain same-origin GET-only, POST/payment redirects remain forbidden, and every redirect hop is resolved and checked again.
- The PassportGate adapter used an all-zero transaction-shaped sentinel when settlement evidence was missing. Settlement expectations now model missing payment ID, payer, transaction hash, and timestamp as `null`; no production failure path invents a transaction hash.
- Evidence types/schema no longer accept `execution_mode: mainnet`. Testnet publication semantics still require settled payments, five gates, independent verification, exact runtime code, and testnet execution.
- Production fixture processes now require an externally supplied secret identity marker, reject zero/repeated development keys, placeholder/local origins and credentials, missing/mismatched full source/image tags, missing immutable image digests, and provider/recipient role reuse. Local test keys remain confined to tests or explicit local fixture helpers.
- Docker images now record the full build commit in the OCI revision label. Backend and fixture production configuration requires the full commit as the image tag and a `sha256:` immutable digest. Docker Compose also refuses an absent database password and passes the exact build commit rather than embedding a credential default.
- A high-confidence repository secret scanner and self-test were added to the mandatory root check. It scans tracked and non-ignored production/configuration sources without printing matched values and detects private-key literals, PEM keys, common token forms, credentialed database URLs, and accidentally tracked/unignored environment files. Current source passes.
- Git object-name inspection found historical `frontend/.env` and `frontend/.env.production` paths. Existing project documentation already treats historical credentials as compromised. Phase 4 did not inspect or print their contents and did not rewrite history because that is destructive and outside this phase. Rotation and coordinated history cleanup remain an explicit release prerequisite.
- The first hardened local production build correctly refused this workstation's untracked local/placeholder public URLs. The refusal was preserved. A separate `build:validation` harness now supplies clearly synthetic, non-secret test anchors only to local build verification; ordinary production builds still fail closed.

### Security tests added or strengthened

- SSRF/private address matrix, trailing-dot local names, cloud metadata, IPv4-mapped IPv6, decimal/hex IPv4, special/reserved ranges, cross-origin redirects, and all POST/payment redirects.
- Outbound unsafe-header and header-injection refusal.
- Exact runtime-bytecode hash acceptance/refusal.
- Production missing dependency, explicit chain identity, immutable image tag/digest, placeholder/local URL, credential, weak/generated identity, role-separation, mainnet, unknown-chain, token-address, and public-bypass refusal.
- CORS allowed-origin/challenge exposure, denied-origin 403, response-only request-header refusal, and disabled local-unpaid-header refusal.
- Frontend mainnet/unknown-chain, local RPC, zero address, placeholder origin, and mandatory public-anchor refusal.
- Production fixture generated/default key, placeholder origin/credential, x402, source revision, and image identity refusal.
- Explicit database-only Passport candidate refusal: a cache match cannot produce ALLOW when the chain record or independent verification is absent.
- Existing adapter/UI contract tests continue to prove operational errors return `verification_unavailable` / HTTP 503 with `decision: null`, never ALLOW or BLOCK.

### Phase 4 files added or changed

- `.env.example`
- `docker-compose.yml`
- `package.json`
- `backend/Dockerfile`
- `backend/src/config.ts`
- `backend/src/chain/preflight.ts`
- `backend/src/chain/registry.ts`
- `backend/src/payments/inbound.ts`
- `backend/src/rest/app.ts`
- `backend/src/security/network.ts`
- `backend/src/security/safe-fetch.ts`
- `backend/src/passport-gate/service.ts`
- `backend/src/workers/rehearsal.ts`
- `backend/src/domain/types.ts`
- `backend/src/evidence/validate.ts`
- `backend/test/config.test.ts`
- `backend/test/network.test.ts`
- `backend/test/routes.test.ts`
- `packages/passport-gate/src/types.ts`
- `packages/passport-gate/src/engine.ts`
- `packages/passport-gate/test/engine.test.ts`
- `fixtures/runtime/src/index.ts`
- `fixtures/runtime/test/fixtures.test.ts`
- all five application/fixture `Dockerfile` files
- `frontend/lib/public-config.ts`
- `frontend/app/layout.tsx`
- `frontend/components/passport-view.tsx`
- `frontend/test/public-config.test.ts`
- `schema/evidence.schema.json`
- `scripts/security-scan.mjs`
- `scripts/run-validation-build.mjs`
- `scripts/fixture-tunnel-common.sh`
- `scripts/validate-demo-env.mjs`
- `PROGRESS_PLAN.md`

### Phase 4 commands and results

The checksum-verified Node 24.18.0 toolchain and pinned pnpm 10.13.1 were used. Foundry 1.7.1 was run from the `contracts` directory so its checked-in `foundry.toml` (`via_ir`, optimizer, source/test paths, and formatter settings) was authoritative.

```text
git status --short --branch
git branch --show-current
git branch -vv --no-color
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}

repository-wide rg scans for chain/network/address/URL/mainnet/development/local-only/header/key/mock/secret patterns
git ls-files sensitive filename scan
git rev-list --objects --all sensitive historical filename scan (names only; no values)

pnpm --filter @launchproof/passport-gate test
pnpm --filter @launchproof/backend exec vitest run test/passport-gate-adapters.test.ts
pnpm --filter @launchproof/frontend test
pnpm security:check
pnpm --filter @launchproof/passport-gate build
pnpm --filter @launchproof/passport-gate typecheck
pnpm --filter @launchproof/passport-gate test
pnpm --filter @launchproof/backend typecheck
pnpm --filter @launchproof/backend exec vitest run test/config.test.ts test/network.test.ts test/routes.test.ts test/passport-gate-adapters.test.ts
pnpm --filter @launchproof/fixture-runtime typecheck
pnpm --filter @launchproof/fixture-runtime test
pnpm --filter @launchproof/frontend typecheck
pnpm --filter @launchproof/frontend exec vitest run test/public-config.test.ts test/payment-policy.test.ts test/judge-client.test.ts test/judge-mode.test.tsx test/rehearsal-errors.test.tsx
pnpm check

cd contracts && forge fmt --check
cd contracts && forge build
cd contracts && forge test -vvv

git diff --check
git diff --exit-code -- contracts/src/LaunchProofRegistry.sol contracts/test/LaunchProofRegistry.t.sol schema/registry.abi.json
skipped-test, conflict-marker, hardcoded mainnet fallback, secret, and whitespace scans
```

Final verified results:

- PassportGate domain: 84/84 pass across two files.
- Backend: 110/110 pass across thirteen files after the expanded 21-case network suite; typecheck and build pass.
- Frontend: 29/29 pass across five files; lint, typecheck, and production validation build pass.
- Fixture runtime: 10/10 pass; runtime and every controlled fixture typecheck/build pass.
- Secret scanner self-test and full current-source scan pass without printing candidate values.
- Solidity: format/build pass and 9/9 contract tests pass. Contract source, tests, and generated ABI remain byte-for-byte unchanged by Phase 4.
- Root `pnpm check` passes, including security scan, contract compiler/ABI check, every workspace lint/typecheck/test, and production validation build.
- `git diff --check`, protected-ref checks, no-upstream check, contract/ABI diff check, skipped-test scan, conflict-marker scan, and final mainnet-fallback scan pass.

### Remaining risks and Phase 4 boundary

- Writer/payment-recovery leadership remains single-process only. `BACKEND_REPLICA_COUNT=1` is still enforced, but this is not sufficient across overlapping deployment revisions. The prompt explicitly prohibited writer-leadership changes in Phase 4, so durable leasing/fencing is deliberately left for Phase 5 and remains a release blocker until implemented and tested.
- No image was built, tagged, pushed, or inspected in a registry in this phase. Production now refuses missing/mismatched commit tags and immutable digests, and OCI revision labels are present, but Phase 5 must build each service from the exact clean commit, tag it with all 40 characters, record each registry-provided digest, and configure the corresponding service with its own digest.
- Historical sensitive environment-file objects remain in Git history. Current tracked/unignored production source passes the scanner, but credential rotation and any coordinated destructive history rewrite are outside Phase 4. No old credential may be reused.
- Public host reachability, live registry bytecode, creation block, writer identity/balance, USD₮0 bytecode/decimals/balance, and facilitator support remain runtime preflight checks. They were not contacted in this no-live-resource phase.
- The mutable upstream `node:24-alpine` base image tag remains a supply-chain reproducibility risk. Release images themselves are now revision-labeled and digest-gated; pinning and validating upstream base-image digests should be included in the Phase 5 release process.

No open technical question blocks Phase 4. The remaining items require the explicitly separate writer-leadership/release phase or destructive credential-history coordination.

## Phase 4 acceptance gate

- [x] Work remained on the isolated non-deployment branch.
- [x] No live platform, database, wallet, contract, endpoint, or chain state changed.
- [x] Required hardcoding, fallback, local-only, generated-key, mock-identifier, and current/historical secret-path searches were completed without exposing values.
- [x] Unsafe production behavior found in scope was removed through fail-closed validated configuration and protocol boundaries.
- [x] Every listed Phase 4 security behavior has a passing test or mandatory scanner self-test.
- [x] Complete original and new lint/typecheck/test/build/contract suites pass.
- [x] No known security or chain-configuration failure is hidden; residual leadership, image-release, base-image, and historical-secret risks are recorded above.
- [x] This progress plan was updated without secrets.

Phase 4 stops here. No writer-leadership mechanism, Phase 5 change, cloud resource, deployment, live payment, wallet operation, contract transaction, or external endpoint mutation was performed.

## Phase 5 completed work

Phase 5 remained on local branch `upgrade/passportgate-phase1-20260719`, which has no upstream. HEAD and the protected local/remote `main` and `release/testnet-hardening-20260717` refs remained at `b538cf8e42687d1a370b3bc12296bd676a73528f`. Nothing was committed, pushed, merged, previewed, or deployed. No Vercel, Railway, Azure, Supabase, wallet, facilitator, contract, RPC, fixture, or other live endpoint was read or changed. No transaction was signed or submitted.

The phase used fresh `MemoryRepository` instances and an isolated in-memory advisory-session database boundary for tests. This workstation has no `postgres`, `initdb`, `psql`, Docker, or Podman executable, so the committed Prisma migration was not applied to a local PostgreSQL process. The live Supabase database and the repository's untracked environment files were deliberately not used.

### Selected leadership mechanism and reason

Source-approved mechanism A was selected: a PostgreSQL session advisory lock plus a durable monotonic fencing epoch.

This fits the existing Prisma/PostgreSQL architecture and safely covers overlapping deployment revisions without relying on `maxReplicas=1`. A dedicated Prisma client is forced to one physical connection and holds advisory lock `(1952, 5001)` for the leader lifetime. Each successful acquisition atomically increments `WriterLeadership.epoch`; the epoch is exposed as the process capability/fence and in non-secret operational state. Standby processes remain read-only and periodically contend for leadership. Connection or lock loss aborts the current leader signal, invalidates its capability, closes the session, and requires a new session plus a higher epoch before takeover.

Production startup now requires `LEADERSHIP_DATABASE_URL` and `LEADERSHIP_DATABASE_MODE=session`. The leadership URL must be a direct or session-mode PostgreSQL connection; a transaction pooler cannot safely hold a session advisory lock. Ordinary operational `DATABASE_URL` remains separate. Deployments on different platforms must point at the same leadership database so only the advisory-lock winner can become writer/payment-recovery leader; a deployment with a different leadership database must not be writer-enabled.

Leadership checks now cover:

- inbound payment verification/settlement authorization;
- target payment signing, signed-attempt persistence, paid request, receipt processing, and recovery;
- run execution and startup run recovery;
- registry publication before signing/broadcast and publication recovery;
- chain index rebuild writes and cursor persistence;
- launch and target settlement recovery before every recovery write;
- startup reconciliation and the periodic publication reconciler.

The signed target authorization and exact registry transaction candidate are persisted before the external settlement/publication boundary. Recovery never creates a replacement while an outcome is ambiguous. Registry publication remains write-once and rechecks leadership immediately before broadcasting; recovery only finalizes the exact candidate reconstructed from independently matching chain state.

Local and test single-process behavior remains compatible through `AlwaysLeader`. Production never uses that compatibility guard.

### Concurrency, idempotency, and recovery evidence

New or strengthened tests prove:

- twelve concurrent process coordinators elect exactly one leader;
- every losing process capability refuses payment, publication, recovery, run execution, and indexing;
- lock/connection loss aborts the old capability and blocks all eight protected capabilities;
- takeover requires a higher durable fence epoch;
- twelve concurrent reservations with one idempotency key still produce one run;
- sixteen concurrent duplicate authorizations bind one immutable payment, and a different authorization cannot replace it;
- an inbound ambiguous settlement retains one immutable transaction and can only be authorized from its exact durable candidate;
- a persisted signed target authorization forbids a replacement payment while deterministic recovery is pending;
- a crash after chain publication but before final database save is recovered by a new `RegistryService` instance from the exact persisted candidate and mocked independently matching chain load;
- a second reconciliation is idempotent and performs no duplicate finalization;
- all original routes, rehearsal behavior, payment policy, PassportGate, frontend, fixture, and contract tests remain green.

The production implementation uses real Prisma/PostgreSQL SQL and a committed migration. Tests mock only the advisory database and chain/RPC boundaries; they do not invent public evidence or expose synthetic test hashes outside test files.

### Testnet acceptance harness

An additive testnet acceptance orchestrator and disabled-by-default real boundary were added. The pure orchestrator was tested entirely with mocked chain/payment boundaries in this phase. The CLI can later run one approved real paid flow with a dedicated payer key supplied only through `ACCEPTANCE_PAYER_PRIVATE_KEY` in process memory.

The harness:

- permanently accepts only chain `1952`, network `eip155:1952`, the official X Layer testnet USD₮0 asset, and six decimals;
- cross-checks the RPC, public project card, current Launch Contract payment terms, and operator-trusted launch/provider recipients before signing;
- calculates and prints the exact maximum test USD₮0 spend before the one paid attempt;
- refuses a total above `ACCEPTANCE_MAX_SPEND_ATOMIC`;
- requires and sends a stable idempotency key;
- never automatically retries after a signed or otherwise ambiguous payment outcome;
- waits for operator-configured receipt confirmations;
- decodes and independently checks both ERC-20 `Transfer` logs;
- independently checks the publication receipt and strict `/verify` reconstruction, including both settlement matches and runtime-bytecode match;
- calls PassportGate and succeeds only for `ALLOW`;
- never logs or persists the payer private key, signed payload, or request headers;
- is disabled unless `ACCEPTANCE_EXECUTE=xlayer-testnet-1952-explicit` is supplied, and still rechecks chain 1952 before payment creation.

The explicit-disable execution was tested with an empty environment and refused before any network call. The approved live mode was not enabled or executed.

### Phase 5 files added or changed

- `.env.example`
- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/202607200001_writer_leadership/migration.sql`
- `backend/src/leadership/leader.ts`
- `backend/src/acceptance/harness.ts`
- `backend/src/acceptance/cli.ts`
- `backend/src/config.ts`
- `backend/src/index.ts`
- `backend/src/rest/app.ts`
- `backend/src/security/safe-fetch.ts`
- `backend/src/chain/registry.ts`
- `backend/src/payments/inbound.ts`
- `backend/src/payments/target.ts`
- `backend/src/workers/rehearsal.ts`
- `backend/test/leadership.test.ts`
- `backend/test/acceptance-harness.test.ts`
- `backend/test/recovery.test.ts`
- `backend/test/config.test.ts`
- `backend/test/idempotency.test.ts`
- `backend/test/payments.test.ts`
- `PROGRESS_PLAN.md`

No Solidity source, contract test, deployed registry address, or generated registry ABI changed.

### Phase 5 commands and results

The final complete run used checksum-verified Node 24.18.0, pinned pnpm 10.13.1, and Foundry 1.7.1.

```text
git status --short --branch
git branch --show-current
git branch -vv --no-color
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717

pnpm --filter @launchproof/backend exec prisma generate
pnpm --filter @launchproof/passport-gate build
pnpm --filter @launchproof/backend typecheck
pnpm --filter @launchproof/backend test
pnpm security:check
pnpm check

env -i ... node node_modules/tsx/dist/cli.mjs src/acceptance/cli.ts

cd contracts && forge fmt --check
cd contracts && forge build
cd contracts && forge test -vvv

git diff --check
git diff --exit-code -- contracts/src/LaunchProofRegistry.sol contracts/test/LaunchProofRegistry.t.sol schema/registry.abi.json
skipped/only-test, conflict-marker, mainnet-anchor, acceptance-secret-reference, leadership-coverage, and protected-ref scans
```

Final verified results:

- PassportGate domain: 84/84 pass.
- Backend: 127/127 pass across sixteen files; typecheck and build pass.
- Frontend: 29/29 pass; lint, typecheck, and production validation build pass.
- Fixture runtime: 10/10 pass; runtime and all controlled fixture typecheck/build tasks pass.
- Solidity: format/build pass and 9/9 tests pass.
- Secret-scanner self-test and repository scan pass.
- Root `pnpm check` passes, including security, ABI consistency, lint, every workspace typecheck/test, and production validation build.
- The acceptance CLI's default-disabled execution exits before inspection/signing/network access.
- `git diff --check`, protected-ref checks, contract/ABI diff check, skipped-test scan, conflict-marker scan, and final source audit pass.

### Remaining operational prerequisites and boundaries

- Before any future production rollout, apply the committed migration to the intended PostgreSQL database and supply one shared direct/session-mode `LEADERSHIP_DATABASE_URL`. Verify advisory-lock behavior against that real provider in a non-live acceptance environment; this was not possible locally without a PostgreSQL executable.
- Do not configure two independent leadership databases for Railway and Azure. Only deployments sharing the one leadership lock domain can overlap safely; otherwise use an explicit stop-old/start-new maintenance rollout.
- The application fence cannot be added to the already deployed immutable registry contract without a new contract deployment. Safety therefore combines session-lock exclusion, connection-loss abort, repeated pre-write/pre-broadcast checks, persisted immutable candidates, exact-transaction recovery, and the registry's existing write-once semantics. No registry change was made.
- Live acceptance still requires explicit approval, sufficient test assets, trusted recipient anchors, a dedicated environment-only payer key, and real service endpoints. Phase 5 intentionally did not exercise it.
- Historical credential rotation/history cleanup and immutable base-image digest pinning remain release concerns already recorded in Phase 4; Phase 5 did not widen scope into destructive history changes or release infrastructure.

## Phase 5 acceptance gate

- [x] Work remained on the isolated non-deployment branch and used isolated in-memory test stores/boundaries; no live database was connected.
- [x] No live service, database, wallet, payment, contract, or endpoint changed.
- [x] Exactly one PostgreSQL advisory-lock/session leadership mechanism with monotonic fencing is implemented and proven under concurrent process simulations.
- [x] Idempotency, duplicate authorization, ambiguous double-pay prevention, publication crash recovery, restart, concurrency, loser fencing, and single-process compatibility tests pass.
- [x] The harness is X Layer testnet-only, recipient/asset locked, spend-capped, idempotent, confirmation-aware, independently verifies both transfers/publication, requires PassportGate `ALLOW`, and cannot auto-retry ambiguity.
- [x] No real payment, signature, RPC call, or chain write occurred.
- [x] Complete existing and affected lint/typecheck/test/build/security/contract suites pass.
- [x] `PROGRESS_PLAN.md` was updated without secrets.

Phase 5 stops here. No Phase 6 change, Azure IaC/resource, deployment, live payment, contract transaction, branch push, or external-service mutation was performed.

## Phase 6 completed work

Phase 6 remained on local branch `upgrade/passportgate-phase1-20260719`, which has no upstream. HEAD and the protected local/remote `main` and `release/testnet-hardening-20260717` refs remained at `b538cf8e42687d1a370b3bc12296bd676a73528f`. Nothing was committed, pushed, merged, previewed, or deployed. No Vercel, Railway, Supabase, Azure, wallet, facilitator, contract, RPC, fixture, DNS, or other live endpoint was changed. No Azure resource was created, changed, queried, or deleted.

Phase 5 was first rechecked from its recorded evidence and then the complete repository regression was rerun after Phase 6. The production application and Solidity contract remain green. Phase 6 adds only parameterized Azure infrastructure-as-code, local validators/tests, non-applying operational scripts, and documentation.

### Azure candidate architecture and safety boundary

The modeled later migration keeps the frontend on Vercel, PostgreSQL on Supabase, and registry/settlements on X Layer testnet. A dedicated Azure resource group contains:

- one Azure Container Apps Consumption environment;
- one backend Container App and four independently addressed fixture Container Apps;
- one user-assigned managed identity;
- one RBAC-enabled Key Vault with purge protection and 90-day soft delete;
- one Log Analytics workspace with 30-day retention and a 1 GB/day ingestion cap;
- optional subscription budget alerts; and
- `AcrPull` access to an explicitly selected existing ACR.

The templates never create an ACR or Azure PostgreSQL instance. Every app is modeled with external HTTPS ingress, single-active-revision mode, startup/readiness/liveness probes, and exactly one minimum and maximum replica. Fixtures use the valid Consumption minimum of 0.25 vCPU/0.5 GiB; the backend candidate is 0.5 vCPU/1 GiB. These are safe starting values, not performance claims. The four fixture origins, signing secret references, provider identities, and declared behaviors are distinct. The healthy fixture retains paid x402 delivery; the controlled invalid-output, schema-drift, and timeout fixtures retain their deterministic declared failure behavior.

All deployment-specific addresses, origins, image names, and chain anchors are parameters. All sensitive values are absent from Bicep/parameter files and represented only by versionless Key Vault secret references. Deployment-mode validation requires exact HTTPS origins, chain/network 1952, the official test USDt0 asset, nonzero and distinct registry/payout/controlled-provider roles, exact 40-character current commit, and all five images from the selected existing ACR in `<repository>:<full-commit>@sha256:<registry-digest>` form. Bicep itself also fails closed on ACR mismatch, commit/digest mismatch, duplicate fixture providers, unsafe payment caps, enabled budget without contacts, and active backend without an approved cutover.

The current backend has no truthful read-only production entry point: production startup performs preflight and joins the Phase 5 writer election. Instead of adding a fake or ignored environment switch in this IaC-only phase, `candidate` mode omits the backend resource and is publication-disabled by construction. `active` mode requires `writerCutoverApproved=true`, the deployment script's exact Phase 7/cost markers, and `OLD_WRITER_DISABLED=yes`. The documented sequence stops and verifies the Railway writer before starting Azure. Rollback disables Azure ingress and scales the Azure backend to zero before Railway may restart. The shared session-mode advisory-lock database remains defense in depth and never authorizes simultaneous independent writers.

### Phase 6 files added or changed

- `.gitignore` (untracked deployment parameters and Azure result artifacts)
- `infra/azure/bicep/resource-group.bicep`
- `infra/azure/bicep/main.bicep`
- `infra/azure/bicep/modules/container-app.bicep`
- `infra/azure/bicep/modules/acr-pull.bicep`
- `infra/azure/bicepconfig.json`
- `infra/azure/parameters/resource-group.parameters.example.json`
- `infra/azure/parameters/candidate.parameters.example.json`
- `infra/azure/key-vault-secret-names.json`
- `infra/azure/scripts/common.sh`
- `infra/azure/scripts/require-version.mjs`
- `infra/azure/scripts/validate-parameters.mjs`
- `infra/azure/scripts/validate-resource-group-parameters.mjs`
- `infra/azure/scripts/validate.sh`
- `infra/azure/scripts/plan.sh`
- `infra/azure/scripts/resource-group-what-if.sh`
- `infra/azure/scripts/verify-images.sh`
- `infra/azure/scripts/what-if.sh`
- `infra/azure/scripts/deploy.sh`
- `infra/azure/scripts/bootstrap-resource-group.sh`
- `infra/azure/scripts/health-acceptance.sh`
- `infra/azure/scripts/rollback.sh`
- `infra/azure/tests/inspect-template.mjs`
- `infra/azure/tests/parameter-safety.mjs`
- `infra/azure/tests/resource-group-parameter-safety.mjs`
- `infra/azure/tests/health-acceptance.mjs`
- `infra/azure/README.md`
- `infra/azure/COSTS.md`
- `infra/azure/ROLLBACK.md`
- `infra/azure/WHAT_IF.md`
- root `package.json` (`iac:validate` command only)
- `PROGRESS_PLAN.md`

### Phase 6 commands and results

The final local run used Bicep CLI 0.45.15, ShellCheck 0.11.0 when linting shell scripts, checksum-verified Node 24.18.0, pinned pnpm 10.13.1, and Foundry 1.7.1.

```text
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD main release/testnet-hardening-20260717 origin/main origin/release/testnet-hardening-20260717
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}

BICEP_CLI=/tmp/launchproof-iac-tools/bicep PATH=/tmp/launchproof-iac-tools:$PATH infra/azure/scripts/validate.sh
BICEP_CLI=/tmp/launchproof-iac-tools/bicep infra/azure/scripts/plan.sh
infra/azure/scripts/resource-group-what-if.sh infra/azure/parameters/resource-group.parameters.example.json <temporary output>
infra/azure/scripts/what-if.sh <example resource group> infra/azure/parameters/candidate.parameters.example.json <temporary output>
infra/azure/scripts/deploy.sh foundation <example resource group> infra/azure/parameters/candidate.parameters.example.json

pnpm check
cd contracts && forge fmt --check
cd contracts && forge build
cd contracts && forge test -vvv

pnpm security:check
git diff --check
git diff --exit-code -- contracts/src/LaunchProofRegistry.sol contracts/test/LaunchProofRegistry.t.sol schema/registry.abi.json
secret/private-key, mutable-image, wildcard-CORS, mainnet-anchor, generated-key, deployment-command, skipped-test, conflict-marker, and protected-ref scans
```

Final verified results:

- Both Bicep entry points compile with the strict repository Bicep configuration and no diagnostics.
- The rendered plan contains exactly five conditional/modelled Container Apps, one environment, one identity, one Key Vault, one capped Log Analytics workspace, two least-privilege role assignments, one optional budget, and no ACR or Azure database creation.
- Example parameters are proven non-secret and intentionally non-deployable. Deployment parameter tests accept structurally valid synthetic candidate and active plans and reject the wrong asset, mutable image, wildcard origin, unapproved or workload-free active writer, duplicate provider identities, an inverted payment cap, an invalid resource prefix, identical primary/fallback RPCs, and an invalid budget date.
- Dedicated resource-group parameter tests accept a valid isolated candidate input and reject placeholders, a wrong commit, a non-candidate environment, and an invalid region identifier.
- The read-only health acceptance script passes against four isolated local TLS fixture servers, including health/chain checks and repeated deterministic manifest hashing. It sends no payment.
- Bash syntax and ShellCheck pass for every infrastructure script.
- The offline ARM plan renders successfully to a temporary untracked file.
- The deployment script refuses before Azure CLI access without the exact Phase 7 approval marker. The cutover path has further cost and old-writer-disabled gates.
- Root `pnpm check` passes: security scan, contract generation/ABI consistency, lint, typecheck, 84 PassportGate tests, 127 backend tests, 29 frontend tests, 10 fixture tests, and all production builds are green (250 application tests total).
- Solidity formatting/build pass and 9/9 Foundry tests pass.
- Contract source, contract tests, deployed address configuration, and generated registry ABI remain unchanged by Phase 6.

### Azure what-if result and precise blocker

Azure CLI is not installed on this workstation (`az` is absent from `PATH`). Therefore no Azure login, tenant, subscription, provider, quota, existing registry, or resource group could be inspected, and neither an authenticated subscription-scope nor resource-group-scope what-if could truthfully be produced. Both guarded what-if scripts were exercised and failed before authentication with the precise missing-CLI error; neither created an output or contacted Azure. This is recorded in `infra/azure/WHAT_IF.md`. Offline Bicep compilation is recorded only as compilation and is not mislabeled as Azure what-if.

The next phase must install Azure CLI 2.76.0 or newer, obtain interactive `az login`, ask the user to select a subscription if ambiguous, confirm an existing safe ACR and supported region/quota, populate an untracked non-secret parameter file, verify the five registry digests, and run subscription/resource-group what-if before any apply operation.

### Cost summary, deviations, and Phase 7 approval

Azure deployment is not represented as free. Five always-on Consumption replicas, Log Analytics ingestion, Key Vault operations, existing ACR storage/pulls, and public/cross-region traffic can incur charges. `maxReplicas=1`, minimum fixture resources, 30-day/1-GB-per-day log limits, optional 80%/100% budget alerts, and omission of Azure PostgreSQL/ACR/App Insights/custom-network resources constrain cost but do not guarantee zero cost. If zero cost is mandatory, Railway must remain live and this IaC must remain unapplied.

The only implementation deviation is the safer candidate behavior described above: the existing backend cannot be honestly started read-only, so candidate mode omits it rather than mimicking a disabled writer. The backend is still fully modeled for the explicitly approved active cutover. A real latency/memory test, real ACR digest inspection, provider/region/quota check, and authenticated what-if remain Phase 7 operational prerequisites because Phase 6 forbids provisioning and this machine has no authenticated Azure CLI.

Before Phase 7, explicit approval is required for the chosen Azure subscription, region, resource group, existing ACR, possible charges, and any apply operation. Backend cutover requires a separate explicit approval after the old Railway writer is stopped and verified. No such approval is inferred from approval of Phase 6.

## Phase 6 acceptance gate

- [x] Work remained on the isolated non-deployment branch.
- [x] No Azure resource was created or changed.
- [x] No Vercel, Railway, Supabase, chain, contract, wallet, or live endpoint changed.
- [x] Parameterized Bicep and scripts validate without embedded secrets or live literals.
- [x] Backend and four fixture apps are modeled with correct availability and writer safety.
- [x] Cost/free-tier risk and the existing-only registry choice are documented honestly.
- [x] The precise missing Azure CLI/authentication/subscription what-if blocker is recorded.
- [x] `PROGRESS_PLAN.md` asks for explicit Phase 7 approval.

Phase 6 stops here. No Phase 7 action, Azure login, Azure what-if, resource apply, image push, writer activation, paid rehearsal, live transaction, branch push, or external-service mutation was performed.

## Phase 7 authorization record

On 2026-07-24, before any Phase 7 resource creation, the user explicitly approved:

- Phase 7 Azure candidate resource creation and possible charges against Azure for Students credits;
- Azure subscription `3207de1c-c619-4e20-bd21-90461932b9ce` in tenant `289aabb0-9ade-4bd3-9018-c6e53b2e0c5c`;
- region `centralindia` and dedicated candidate resource group `launchproof-phase7-candidate`;
- creation of a separately approved Basic ACR named `launchproofp73207de1c`, subject to global-name availability, in the candidate resource group with the admin account disabled;
- the observed Central India retail estimate of approximately USD 0.1666/day for the Basic registry unit, plus possible storage, ACR Task, transfer, Container Apps, logging, Key Vault, and other usage charges;
- creation of a new isolated Supabase project named `launchproof-phase7-candidate`, application of existing Prisma migrations to that project, and use of a separate SELECT-only runtime role;
- installation of the official Supabase CLI locally if the claimed existing installation could not be found;
- a local immutable commit on isolated branch `upgrade/passportgate-phase1-20260719`, without pushing it; and
- implementation of a genuine read-only backend mode before deployment.

The user separately confirmed the read-only design. The approved mode must never instantiate `LeaderCoordinator`, call `postgresAdvisorySessionFactory`, receive `LEADERSHIP_DATABASE_URL`, acquire the PostgreSQL advisory lease, increment a fence, start indexing/recovery/reconciliation, register payment middleware, issue an HTTP 402 challenge, or receive registry-writer, target-payer, or facilitator secrets. Mutating REST/MCP routes must fail closed; public PassportGate, passport retrieval, schema, health, and on-chain reconstruction remain read-only. The runtime database identity must have SELECT-only privileges and all repository mutation methods must fail closed.

The user explicitly did not authorize stopping Railway, changing Vercel, activating an Azure writer, performing payments/testnet transactions, pushing the isolated branch, or touching `main`, `release/testnet-hardening-20260717`, or any origin/deployment branch. The live Supabase project must never be connected, linked, pushed to, or modified. Unexpected Azure authentication, subscription, or what-if state remains a mandatory stop condition.

This authorization record does not itself prove the what-if or acceptance gates. Those results, immutable commits/digests, created resource identities, observed costs, deviations, and final Phase 7 acceptance evidence must be appended below without secrets.

### Phase 7 read-only implementation before cloud access

The approved Phase 5/6 working tree was first captured locally as immutable commit `bf1c8bf515eea2079f369f8f5a90464ae560aac0` on isolated branch `upgrade/passportgate-phase1-20260719`. It was not pushed. Protected local and remote deployment refs were not changed.

The candidate backend now has an explicit `BACKEND_MODE=read-only` production mode with independent fail-closed layers:

- production configuration requires the mode explicitly and rejects x402, registry-writer/target-payer private keys, OKX facilitator credentials, a leadership database URL/mode, and local/private execution bypasses;
- `createRuntimeLeadership` returns `ReadOnlyLeaderGuard` before considering any session factory, so the read-only process cannot instantiate `LeaderCoordinator`, open the leadership database, acquire an advisory lock, or increment a fencing epoch;
- read-only startup skips chain indexing, pending-publication recovery, payment recovery, target-payment recovery, run recovery, and the publication reconciliation timer;
- payment middleware is not registered, and all rehearsal/renewal REST and MCP entry points return a retry-unsafe HTTP 503 without a 402 challenge;
- `ReadOnlyRepository` rejects every repository mutation and lock/cursor write while delegating only reads;
- public health, schema, status, Service Passport, PassportGate, and read-only X Layer registry reconstruction remain available;
- chain startup preflight verifies chain 1952, both RPC configuration anchors, registry bytecode/creation block/runtime hash/evidence limit/writer identity, and the official test USD₮0 bytecode/decimals without loading a wallet or contacting the facilitator; and
- health reports `backend_mode=read-only`, x402 `disabled_read_only`, and writer leadership `disabled`.

The Phase 7 Bicep mode deploys the backend with only `backend-readonly-database-url`. Writer, payer, facilitator, and leadership secret references exist solely in the separately gated future `active` branch of the template. `read-only` requires `writerCutoverApproved=false`; `active` requires a separately approved cutover, all workloads, and the backend. Foundation, fixture-only, and read-only deployment stages are distinct. The read-only health acceptance script requires reachable database/registry dependencies and the disabled x402/leadership state.

The separately approved Basic ACR is modeled in its own resource-group-scoped template with SKU `Basic`, admin credentials disabled, no anonymous pull, project/candidate/commit tags, and separate what-if/apply approval markers. It is not hidden inside the main candidate deployment.

Local verification before any Azure/Supabase contact:

```text
pnpm --filter backend typecheck
pnpm --filter backend test
BICEP_CLI=/home/kevin-cruz/.azure/bin/bicep infra/azure/scripts/validate.sh
git diff --check
```

Results: backend typecheck passed; 133/133 backend tests passed; all three Bicep entry points compiled using Bicep 0.45.15; parameter, rendered-template, resource-group, health-acceptance, Bash, and ShellCheck safety suites passed. The local IaC test still confirms that `main.bicep` itself creates no registry or database; ACR creation is isolated in the separately approved template. No cloud identity had been queried and no cloud resource had been created at this checkpoint.

On 2026-07-24 the first complete Azure resource-group what-if stopped with `WorkloadProfilePropertyNotSupported`: Azure Central India does not accept environment-level `minimumCount` or `maximumCount` on the Consumption workload profile. No resource from that failed what-if was applied. The user explicitly replied `APPROVE CONSUMPTION PROFILE FIX`, authorizing removal of only those two unsupported environment-profile properties. Per-app `minReplicas=1` and `maxReplicas=1` remain mandatory and covered by the rendered-template test.

### Phase 7 completed candidate deployment

Phase 7 deployed only the approved read-only candidate from isolated branch `upgrade/passportgate-phase1-20260719`. The branch has no upstream and was not pushed. The live/deployment-linked refs were not checked out or modified. The immutable deployed source commit is:

```text
81d8bf43cc12942b0155563ae310cc86a3aa5acf
```

An initial exact-SHA candidate at `904fcff325fc11247d6c90a69629d9a6c0d0ecd7` passed health and fail-closed mutation tests but revealed that historical fixture verification was coupled to the fixture's current hostname. That revision was superseded before acceptance. The isolated fix recognizes a historical fixture host in read-only mode only when its stable provider identity is one of the configured fixture identities. Writer mode remains strictly bound to the current configured origin and identity. Two focused tests prove both sides of that boundary, and all 135 backend tests pass.

The final immutable image set is:

| Workload | ACR digest |
| --- | --- |
| backend | `sha256:dc60ea7376bfd092d346ce9b23879c8b7c8e2e416c1a8c375d7c6cc3d4c622c8` |
| healthy fixture | `sha256:6ec47946037be0cb3a7cb08f45f3e9248a26a9a37395a933b49b38d055b38c59` |
| invalid-output fixture | `sha256:776d0afb8e0bf8a49eed062e7400827da8c1f24e9fa17c2154a61ba30c86d96d` |
| schema-drift fixture | `sha256:e6759e11d2a85f9af0087e0bd84e0f733a8bbc9ef9e943d5c179ce1bc3931db9` |
| timeout fixture | `sha256:80017cc481c6182a6a90a7a54f28fda46cc38c281da07d81fb4ec32c9c2b8d9d` |

All five images were verified in `launchproofp73207de1c` before apply and deployed with the exact 40-character source SHA plus digest. Azure ACR Tasks were unavailable to the Students subscription (`TasksOperationsNotAllowed`), so checksum-verified upstream BuildKit v0.31.2 was used locally. No development/default/generated production identity was used.

Created Azure resources in approved group `launchproof-phase7-candidate`:

- Basic ACR `launchproofp73207de1c`, with admin and anonymous pull disabled;
- Container Apps environment `launchproof-4n5cwi34-cae`;
- Key Vault `launchproof-4n5cwi34-kv`;
- Log Analytics workspace `launchproof-4n5cwi34-logs`;
- managed identity `launchproof-identity`;
- backend `https://launchproof-backend.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`;
- healthy fixture `https://launchproof-fixture-healthy.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`;
- invalid-output fixture `https://launchproof-fixture-invalid.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`;
- schema-drift fixture `https://launchproof-fixture-drift.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`;
- timeout fixture `https://launchproof-fixture-timeout.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`; and
- monthly resource-group budget `launchproof-monthly-budget`, amount `10`.

The final authenticated what-if succeeded before the final apply. It contained the same five apps, environment, identity, Key Vault/managed-identity secret role, capped logs, budget, ignored pre-existing approved ACR, and the expected preview limitation for the cross-scope `AcrPull` assignment. It contained no delete, Azure database, writer activation, or external routing change.

The isolated Supabase candidate is project `launchproof-phase7-candidate`, reference `nozauounvbtwpjxajifg`, region `ap-south-1`, Nano/free. The four existing Prisma migrations were applied. Runtime role `launchproof_readonly` has no superuser, create-database, create-role, replication, or RLS-bypass capability; it has SELECT but no mutation privileges and defaults to read-only transactions. A real INSERT was rejected. The live LaunchProof Supabase project was never linked, connected, pushed to, or modified.

### Phase 7 acceptance evidence

The final no-payment acceptance established:

- all five Container Apps are provisioned/running, use single-active-revision mode, have exactly one traffic-serving revision, and retain per-app `minReplicas=1` and `maxReplicas=1`;
- backend health reports `backend_mode=read-only`, database/registry reachable, x402 `disabled_read_only`, and leadership `disabled`;
- the backend has no registry-writer, target-payer, facilitator, leadership, local-unpaid, or private-target capability; the only backend secret reference is the SELECT-only database URL through Key Vault;
- temporary human Key Vault roles were removed after secret insertion and each deployment preflight;
- all mutating REST/MCP endpoints return HTTP 503 `read_only_candidate` without any payment challenge;
- all four Launch Contracts are deterministic and pass strict schema, exact source revision, stable secret-backed provider identity, same-origin endpoint, and declaration-signature verification;
- REST and MCP PassportGate results validate against the published schema, the exact Vercel origin passes CORS, and an untrusted origin is denied;
- prior run `0xd348748baf9fc8cde21ea1b0bca66db65cc98b82ecd3c7b7299ca9d48b14aa1d` reconstructs with no database cache and independently verifies `match=true`, including chain record, canonical JCS, all hashes, provider signature, gate/storage/link semantics, both testnet transfers, registry runtime, and semantic evidence;
- X Layer primary RPC reports chain 1952, registry `0x99313b45b234e06eba1fc8fe7bee101b7f2f2c37` matches runtime hash `0xe367ae4a310bf429601d9cc43d4191e7d2c9e90056d3183918ba7cc8ac872553`, and official test USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` has deployed bytecode;
- the existing Railway writer remains healthy, registry/database reachable, and x402 startup-preflight ready, while Azure is provably incapable of writer leadership; and
- Vercel remains reachable and was not reconfigured.

The official configured secondary RPC `https://xlayertestrpc.okx.com/terigon` reset connections from this workstation during the final probe even though it remains listed in current OKX documentation. It remains configured after the healthy official primary and was not silently replaced with an unofficial endpoint.

Final local regression:

```text
pnpm check
infra/azure/scripts/validate.sh
infra/azure/scripts/verify-images.sh <protected candidate parameters>
infra/azure/scripts/health-acceptance.sh
git diff --check
```

`pnpm check` passes security scanning, contract compilation/ABI refresh, lint, all workspace typechecks, 84 PassportGate tests, 135 backend tests, 29 frontend tests, 10 fixture tests, and all production builds: 258 application tests total. The contract source/tests are unchanged; the compile/ABI consistency step passes. Infrastructure Bicep, parameter, rendered-template, Bash, and ShellCheck validation pass.

The approved Basic ACR estimate observed before creation was approximately USD 0.1666/day plus storage/transfer. Container Apps, Key Vault operations, logging, registry storage/pulls, and traffic can also charge. The budget query immediately after deployment reported amount `10` and current spend `0.0 INR`, but billing can lag and zero cost is not claimed.

No payment, wallet signature, testnet transaction, registry publication, writer cutover, Railway/Vercel setting change, live Supabase access, protected-branch modification, or branch push occurred.

## Phase 7 acceptance gate

- [x] Explicit Phase 7 approval was confirmed and recorded before resource creation.
- [x] Only approved candidate Azure resources were created.
- [x] Source came from the isolated branch; no deployed branch was changed.
- [x] Live Vercel, Railway, live Supabase, registry, and wallets were unchanged.
- [x] Azure backend is provably read-only/publication-disabled/payment-disabled.
- [x] Exactly one existing Railway writer remains active.
- [x] Candidate health, fixtures, schemas, signatures, REST/MCP/Judge access, and prior Passport read-only verification pass.
- [x] Immutable commit and all five image digests are recorded.
- [x] Costs, deviations, commands, and results are documented without secrets.

Phase 7 stops here. Azure writer activation, Railway shutdown, Vercel cutover, paid rehearsal, any transaction, branch push, and Phase 8 remain unapproved and were not performed.

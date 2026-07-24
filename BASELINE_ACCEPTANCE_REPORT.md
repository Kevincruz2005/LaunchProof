# LaunchProof Phase 0 Baseline Acceptance Report

- Date: 2026-07-19
- Phase: 0 — read-only baseline and deployment-link audit
- Repository: `https://github.com/Kevincruz2005/LaunchProof`
- Starting branch: `main`
- Starting and audited commit: `b538cf8e42687d1a370b3bc12296bd676a73528f`

## 1. Acceptance result

Phase 0 is accepted as a truthful baseline.

- No product code, application configuration, Git reference, database, contract, wallet, chain state, or deployment was changed.
- No checkout, branch creation, commit, merge, push, deployment, paid call, wallet signature, or database migration was performed.
- Only this report and `PROGRESS_PLAN.md` were created in the repository.
- The current source builds and its complete local suite passes under the supported Node and pnpm toolchain.
- The documented paid Passport was verified without making a payment.
- Platform inspection found no Git-linked automatic deployment for the audited Vercel, Railway, or Supabase resources. GitHub CI does run on every pushed branch.
- No environment file or platform secret value was read into output. No private key, database credential, OKX credential, passphrase, mnemonic, or session token is recorded here.

One important release-safety gap was found: the backend enforces a configured replica count of one and uses transaction-scoped PostgreSQL advisory locks, but it does not hold a cluster-wide leader lease for registry writing and recovery loops. `maxReplicas=1` does not by itself prevent overlap between old and new Railway revisions. This must be addressed before any upgraded candidate is allowed to replace production.

## 2. Repository and source baseline

| Fact | Observed result |
|---|---|
| Worktree before Phase 0 | Clean |
| Current local branch | `main` |
| `HEAD` | `b538cf8e42687d1a370b3bc12296bd676a73528f` |
| `origin/main` | `b538cf8e42687d1a370b3bc12296bd676a73528f` |
| Preserved release branch | `release/testnet-hardening-20260717` at the same commit |
| Older deployment branch | `origin/deployment` at `dcf5ca7617d0aba7c820a628292559836b56600f` |
| Applicable `AGENTS.md` files | None found |
| Existing `PROGRESS_PLAN.md` | Did not exist; Phase 0 is the first recorded phase |
| Live backend/fixture source | `5fa2c80b3b2370724616ae3d0abc50865a8281af` |
| Live frontend source | `b538cf8e42687d1a370b3bc12296bd676a73528f` |

There are four commits from the backend/fixture release commit to the current source tip. The diff is limited to the frontend, frontend tests, README, and demo/implementation documentation; backend, contracts, Prisma, and fixtures are unchanged. Therefore `b538cf8e42687d1a370b3bc12296bd676a73528f` is the recommended safe source base: it contains the live backend implementation plus the currently deployed frontend fixes, and it passes the full baseline.

The older `deployment` branch remains unsuitable as a base. Its Vercel Functions backend, committed environment history, permissive/development behavior, hardcoded fixture catalog, old chain configuration, and serverless recovery model were explicitly rejected in the current architecture. Its most recent public CI run also failed.

## 3. Deployment-link and auto-deploy audit

### Vercel

The active project is `launchproof-xlayer-testnet`, rooted at `frontend` and running Node 24.x. Its project record has no Git repository link. The inspected deployment history identifies every active production deployment as `source=cli`.

The current production deployment is:

- status: ready;
- source: CLI;
- source metadata branch: `release/testnet-hardening-20260717`;
- source commit: `b538cf8e42687d1a370b3bc12296bd676a73528f`;
- public alias: `https://launchproof-xlayer-testnet.vercel.app`.

An additional unlinked Vercel project named `frontend` exists from an erroneous CLI linkage. Its only inspected deployment is in error state, has no Git ref/SHA, and is not the LaunchProof production alias.

Conclusion: pushing an arbitrary branch does not automatically deploy either audited Vercel project. Production remains connected operationally to the release branch/commit through CLI deployment metadata, so neither `main` nor `release/testnet-hardening-20260717` may be modified during ordinary upgrade phases.

### Railway

The linked CLI project is `launchproof-testnet`, production environment. Five services are live:

| Service | Source linkage | Runtime source | Replicas | Deployment method |
|---|---|---|---:|---|
| `launchproof-api` | `sourceRepo=null` | `5fa2c80b3b2370724616ae3d0abc50865a8281af` | 1 | CLI |
| `launchproof-fixture-healthy` | `sourceRepo=null` | same | 1 | CLI |
| `launchproof-fixture-invalid` | `sourceRepo=null` | same | 1 | CLI |
| `launchproof-fixture-schema` | `sourceRepo=null` | same | 1 | CLI |
| `launchproof-fixture-timeout` | `sourceRepo=null` | same | 1 | CLI |

Every service has a successful active deployment and an immutable Railway image digest. No service is linked to a Git repository, so branch pushes do not automatically deploy Railway. The images are recorded by digest, but the audit did not find an externally named image tag containing the full Git SHA; future release evidence should record both full-SHA tag and digest explicitly.

### Supabase

The `launchproof-testnet` PostgreSQL project is active and healthy. The local repository is not linked to a Supabase project, and no Supabase branch/source integration was found. Supabase is used only as the operational PostgreSQL queue/cache/recovery store. No database content or credentials were inspected, and no migration was applied.

### GitHub

`.github/workflows/ci.yml` has unfiltered `push`, `pull_request`, and manual triggers. Public Actions history confirms that pushes to `main`, `release/testnet-hardening-20260717`, and `deployment` start CI. The GitHub Deployments API returned no deployment records.

Conclusion: pushing a future feature branch would trigger GitHub CI, but no audited production platform deployment. The phased plan nevertheless requires the upgrade branch to remain local until a later explicit approval.

### Deployment-linked branches and commits

Treat all of the following as protected during ordinary phases:

- `main` at `b538cf8e42687d1a370b3bc12296bd676a73528f`;
- `release/testnet-hardening-20260717` at the same commit;
- runtime release commit `5fa2c80b3b2370724616ae3d0abc50865a8281af` used by Railway API/fixtures;
- `origin/deployment` as a quarantined historical branch, not a valid source base.

No Phase 0 Git reference was changed.

## 4. Architecture and implementation audit

### Backend and startup validation

- Production is testnet-only and rejects a chain ID other than `1952` or CAIP network other than `eip155:1952`.
- The official X Layer testnet USD₮0 address is enforced in typed configuration.
- Production requires x402, primary/fallback RPCs, database, registry anchors/runtime hash/writer, payout, target payer, OKX credentials, four explicit fixture URLs, and four distinct fixture providers.
- Production rejects both local unpaid and private-target escape hatches.
- Public/chain-ready/x402 operation is rejected under `NODE_ENV=development`.
- `BUILD_COMMIT_SHA` must be a full 40-character SHA for chain-ready and production operation.
- Startup checks chain ID, registry deployment boundary, runtime hash, immutable writer, evidence limit, role separation, token code/decimals, gas/token funding, and facilitator support.

### PostgreSQL and migrations

- Prisma models durable run reservation/state, invocations, launch/target payments, provider records, chain cursor, fixtures, and campaign events.
- Unique constraints prevent idempotency-key and settlement-transaction reuse and restrict each run to one payment per kind.
- Transaction-scoped PostgreSQL advisory locks serialize capacity, payment, publication, and recovery state changes.
- Three ordered migrations are committed.
- The Prisma schema validated and generated a complete PostgreSQL migration script from an empty schema without connecting to a database.
- Migrations were deliberately not applied to any local or live database in Phase 0 because the phase prohibits database changes.

### Payments

- Inbound LaunchProof routes use the official OKX x402 server packages and exact scheme.
- The request body and `idempotency-key` header are bound exactly to target, operation, and renewal lineage.
- Settlement candidates are persisted before receipt waiting; ambiguous outcomes are reconciled without replacement charging.
- Launch and target payment receipts are independently checked for successful X Layer receipts and exact USD₮0 `Transfer` logs.
- Target payment is restricted to the signed manifest resource, configured public-host allowlist, exact chain/asset/recipient/amount, and configured per-run/daily caps.
- Discovery is uncharged; paid delivery is one-shot and cannot be retried automatically.

### MCP/A2MCP and evidence

- Launch Contracts are strict, bounded, HTTPS-only public manifests with exact schemas, source SHA, provider identity, safety declaration, and optional exact x402 terms.
- MCP initialization requires protocol `2025-06-18`, tools capability, a unique declared tool, and bounded closed input schema.
- A normal run performs one fixed sample, one controlled invalid input, exactly three fresh challenges, and optional paid delivery.
- Evidence is reduced to declared fields, sanitized, RFC 8785/JCS canonicalized, SHA-256 hashed, and capped at 65,536 bytes.
- `verified` requires all five gates, testnet execution, verified provider declaration, settled LaunchProof payment, and settled target payment.
- Local, unpaid, not-tested, partial, mocked, or synthetic-publication states cannot become Verified.

### Registry and verifier

- `LaunchProofRegistry` has one immutable writer and write-once nonzero run IDs.
- It enforces evidence hash/size, gate/status mapping, provider signature, fixture signature, and caller-independent writer/timestamp anchors.
- Storage keeps critical hashes; the `RunPublished` event keeps bounded canonical evidence.
- `/verify/:runId` reconstructs from registry storage/event data, recomputes canonical/hash/signature/gate semantics, checks both token transfers, checks registry runtime bytecode, and reports database cache equality separately.
- PostgreSQL cannot make chain verification pass.

### Frontend and wallet

- Public routes for landing, rehearsal, fixtures, status, quick verification, Passport, receipt, comparison, and direct verification remain present.
- The browser validates X Layer testnet, official test USD₮0, exact prices, payout, and configured registry anchors before paid signing.
- Wallet selection is tab-scoped and supports explicit permission request/revocation through the injected EVM provider.
- No 64-byte hex literal or backend secret variable was found in tracked frontend code.
- The production frontend currently has valid public anchors, but the build wrapper itself does not require every production `NEXT_PUBLIC_*` anchor. Some checks are conditional when an anchor is absent, and `NEXT_PUBLIC_API_BASE_URL` has a localhost fallback. A future phase should make production frontend builds fail closed before deployment.

### Fixtures and CI

- Healthy, invalid-output, schema-drift, and timeout variants share the same real MCP/x402 runtime but use separate signed provider identities and explicit origins.
- Only the healthy fixture enables paid delivery in the live environment.
- CI runs pinned pnpm install, Prisma generation, script syntax, contract ABI generation/diff, lint, typecheck, application tests, builds, Foundry formatting/build/tests, and an optional manually triggered live verifier.
- Live end-to-end verification is manual, not part of every normal CI push.

## 5. Chain and payment configuration

The repository, live project card, both tested RPCs, registry storage, and current official OKX documentation agree on the following public profile:

| Setting | Verified value |
|---|---|
| Network | X Layer testnet |
| Chain ID | `1952` (`0x7a0`) |
| CAIP-2 | `eip155:1952` |
| Primary RPC | `https://testrpc.xlayer.tech/terigon` |
| Fallback RPC | `https://xlayertestrpc.okx.com/terigon` |
| Explorer | `https://www.okx.com/web3/explorer/xlayer-test` |
| Test USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` |
| Decimals | `6` |
| Registry | `0x99313b45b234e06eba1fc8fe7bee101b7f2f2c37` |
| Deployment block | `35805522` |
| Runtime hash | `0xe367ae4a310bf429601d9cc43d4191e7d2c9e90056d3183918ba7cc8ac872553` |
| Genesis price | `10000` atomic = `0.01` test USD₮0 |
| Renewal price | `100000` atomic = `0.10` test USD₮0 |
| Public x402 | Enabled and ready |
| Public unpaid bypass | Disabled |

Official references checked:

- [OKX X Layer RPC endpoints](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints)
- [OKX X Layer network information](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information)
- [OKX x402 buyer testnet example](https://web3.okx.com/onchainos/dev-docs/payments/payment-use-buyer)

The fallback RPC produced intermittent connection resets for `cast`, but a retried JSON-RPC `eth_chainId` request returned `0x7a0`. This is a public-RPC reliability observation, not a chain-identity mismatch.

## 6. Local baseline results

Pinned test toolchain:

- Node `24.18.0`, official archive SHA-256 verified before use;
- pnpm `10.13.1` from repository `packageManager`;
- Foundry/Forge `1.7.1`, official release archive SHA-256 verified before use;
- Prisma CLI/client `6.19.3` from the frozen lockfile.

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass; lockfile already current |
| Prisma client generation | Pass |
| `pnpm contract:build` | Pass; 3,184-byte creation bytecode; ABI unchanged |
| Lint | Pass; no warnings/errors |
| TypeScript checks | Pass for backend, frontend, fixture runtime, and four fixture packages |
| Backend tests | Pass: 12 files, 81 tests |
| Frontend tests | Pass: 1 file, 8 tests |
| Fixture runtime tests | Pass: 1 file, 7 tests |
| Backend build | Pass |
| Frontend production build | Pass; all ten routes compiled/generated |
| Fixture builds | Pass |
| `forge fmt --check` | Pass |
| `forge build` | Pass |
| `forge test -vvv` | Pass: 9 tests, 0 failed/skipped |
| Shell syntax | Pass for every `scripts/*.sh` |
| Node syntax | Pass for every `scripts/*.mjs` |
| JSON parse | Pass for every committed schema JSON |
| Strict JSON Schema compile | Pass for Launch Contract, evidence, and Passport under draft 2020-12 with format validation |
| Prisma schema validation | Pass |
| Empty-to-datamodel migration SQL generation | Pass: 132 lines, 11 table/index statements |
| `git diff --check` | Pass |
| Generated registry ABI diff | Clean |
| Tracked source changes after checks | None before report creation |

Diagnostic adjustments were recorded rather than hidden:

1. The first aggregate check stopped immediately because nested package scripts could not find a `pnpm` executable. A temporary `/tmp` launcher bound them to the verified Node 24/pnpm 10.13.1 pair; the full check then passed.
2. The host Node 26 installation is outside the project engine range. All authoritative application checks used the verified Node 24 binary in `/tmp`.
3. An initial Prisma validation lacked `DATABASE_URL`. It was rerun with an inert, non-connected placeholder URL solely for schema parsing and passed.
4. `ajv-cli@5` could not compile draft 2020-12 or registered formats. A temporary Ajv 8.17.1 plus `ajv-formats` harness in `/tmp` compiled all three schemas strictly.
5. One GitHub API read was interrupted over HTTP/2. A smaller HTTP/1.1 retry succeeded.
6. No migration was applied because Phase 0 forbids database modification.

## 7. Live unpaid acceptance

The following returned HTTP 200 without a paid action:

- `https://launchproof-xlayer-testnet.vercel.app`
- `https://launchproof-api-production.up.railway.app/healthz`
- `https://launchproof-api-production.up.railway.app/status`
- `https://launchproof-api-production.up.railway.app/fixtures`
- `https://launchproof-api-production.up.railway.app/schema/openapi.json`
- all four Railway fixture `/healthz` endpoints;
- healthy fixture `/.well-known/launch-contract.json`;
- the documented Passport page and direct browser Verify page;
- API `/runs/:runId` and `/verify/:runId` for the documented run.

Live health reports:

- build commit `5fa2c80b3b2370724616ae3d0abc50865a8281af`;
- x402 startup preflight ready;
- registry reachable;
- database reachable;
- service `testnet_ready`;
- x402 enabled and payment ready;
- local unpaid disabled;
- backend replica count reported as one;
- all four fixture health endpoints report `eip155:1952`, the official asset, and the same full source revision.

`OKX_AI_LISTING_URL` is not configured in the live status response. This is a submission-readiness limitation, not a runtime integrity failure.

## 8. Independent verification of the documented paid Passport

Run:

`0xfc904b9b51ec8f9036abe8bcf0b67bd4ab655468b0c4c04415cdc91b24b175ef`

Observed API result:

- state `complete`;
- execution mode `testnet`;
- network `eip155:1952`;
- Passport `verified`;
- all five gates `pass`;
- three fresh challenges present and passing;
- build and source revision `5fa2c80b3b2370724616ae3d0abc50865a8281af`;
- LaunchProof and target payments both `settled`;
- registry publication marked true at block `35817253`.

Observed transactions:

| Purpose | Transaction | Direct receipt result |
|---|---|---|
| LaunchProof x402 | `0x3e11981acb2fc233622c79f8e2009b175f5a26d18a611965b3c154efc5eda252` | Success; exact official-token transfer of `10000` |
| Target paid delivery | `0x2f30444a8d5f9b24fa3b81cd189ab3d388a73e617e99df340eabeadd13f9d9a2` | Success; exact official-token transfer of `10000` |
| Registry publication | `0x150e7d59ffa00c0d2888d60f830fb6d4aa852948953fb6463aa5173e2ff63d82` | Success; sent to configured registry |

Independent checks performed:

- `scripts/verify-run.sh` passed without a paid action.
- `/verify/:runId` returned true for chain record, canonical JCS, evidence/manifest/input/result hashes, provider signature, gate/status mapping, storage, link fields, evidence semantics, both transfers, registry runtime, cache equality, and aggregate `match`.
- A local independent JCS reconstruction exactly equaled `canonical_evidence_jcs`.
- Local SHA-256 recomputation matched the evidence hash and manifest hash.
- Local EIP-191 recovery matched the declared provider address.
- Direct RPC returned chain ID `1952`.
- Direct `eth_getCode` plus Keccak matched the configured registry runtime hash.
- Direct `getRun(bytes32)` returned the same evidence and manifest hashes, immutable writer/provider anchors, all-pass bitmap `341`, Verified status `2`, and true provider-signature/fixture flags.
- Direct receipts showed successful transactions and exact ERC-20 `Transfer` events on the official test USD₮0 contract for both payments.

This verifies the documented evidence independently of a PostgreSQL row. It does not turn LaunchProof into a decentralized oracle: the registry proves the configured writer's immutable attestation of off-chain MCP/HTTPS observations.

## 9. Known limitations and Phase 1 constraints

1. **No cluster-wide leader lease.** Startup recovery and the periodic publication reconciliation loop run in each process. Transaction locks protect individual state changes, but there is no session-level/advisory leader lease fencing rolling revision overlap. This is the highest-priority release-engineering gap.
2. **Split live source provenance.** Vercel is at `b538cf8…`; Railway API/fixtures are at `5fa2c80…`. Their relevant code is compatible today, but a future candidate must deploy the exact same full SHA everywhere.
3. **Image provenance needs a release manifest.** Railway exposes immutable digests, but full-SHA image tags and a checked deployment manifest are not recorded together.
4. **Frontend build validation is not fully fail-closed.** Production public variables are valid live, but the build wrapper does not require every anchor and some browser anchor checks are conditional.
5. **Public RPC reliability.** The fallback endpoint intermittently reset connections during this audit, though a retry returned the correct chain ID.
6. **Migration execution not tested in Phase 0.** Static schema/migration generation passed; no database was mutated by design.
7. **Normal CI omits live E2E.** The chain verifier job is manual, which is correct for avoiding paid actions but means ordinary pushes do not prove live compatibility.
8. **Historical secret exposure remains a repository-history issue.** Current tracked source contains no usable credential, but documentation records an exposed key in older history. Rotation does not erase old Git objects or clones.
9. **Single-writer trust boundary.** Registry evidence is immutable and independently reproducible, but service execution remains an off-chain observation by one configured writer.
10. **Narrow supported product profile.** Only `structured-extraction-v1`, bounded synthetic/read-only MCP services, X Layer testnet, and exact USD₮0 settlement are supported.
11. **Submission metadata incomplete.** The live OKX.AI listing URL is not configured.
12. **Unused erroneous Vercel project.** The unlinked `frontend` project is not production but should be removed only in a later explicitly approved platform-cleanup phase.

## 10. Safe base and proposed Phase 1 branch

Verified safe base:

`b538cf8e42687d1a370b3bc12296bd676a73528f`

Proposed unique local branch:

`upgrade/passportgate-phase1-20260719`

The branch was not created in Phase 0. Phase 1 should create it locally from the exact safe base without checking out, committing on, merging into, or pushing `main`, `release/testnet-hardening-20260717`, or `deployment`. It must not be linked to Vercel, Railway, Supabase, or another deployment integration and must remain local until a later phase explicitly authorizes a push.

## 11. Commands executed

The following command groups were executed. Read-only inspection commands using `sed`, `rg`, `find`, `wc`, `git log`, and `git diff` are grouped by purpose; no `.env` or secret store was printed.

```text
git status --short --branch
git branch --show-current
git rev-parse HEAD
git branch -a -vv
git remote -v
git log --all --oneline --decorate
git diff --stat 5fa2c80b...b538cf8e...
git status --short
git diff --check
git diff --exit-code -- schema/registry.abi.json

rg --files -g 'AGENTS.md' ...
rg --files ...
sed/rg inspections of README.md, setup.md, package scripts, implementation/architecture/threat/reproduction docs,
backend configuration/startup, Prisma schema/migrations, payment services, worker, registry/verifier,
Solidity source/tests/deploy script, schemas, frontend routes/wallet/client, fixtures, CI, Docker and hosting files

vercel project inspect launchproof-xlayer-testnet
vercel api /v9/projects/<active-project>
vercel api /v6/deployments?projectId=<active-project>
vercel api /v9/projects?limit=100
vercel api /v6/deployments?projectId=<unlinked-frontend-project>
railway status --json (filtered to non-secret deployment metadata)
supabase projects list --output json (filtered to public project metadata)
GitHub public Actions and Deployments API reads

official Node 24.18.0 archive download + published SHA-256 verification
official Foundry 1.7.1 archive download + release SHA-256 verification
pnpm 10.13.1 install --frozen-lockfile
pnpm --filter @launchproof/backend exec prisma generate
pnpm check
forge fmt --check
forge build
forge test -vvv
prisma validate --schema prisma/schema.prisma
prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
bash -n scripts/*.sh
node --check scripts/*.mjs
jq empty schema/*.json
strict Ajv 8 draft 2020-12 compilation of Launch Contract, evidence, and Passport schemas

unpaid curl reads of web, health, status, fixtures, schemas, Launch Contract, Passport, run, and verify endpoints
PUBLIC_API_BASE_URL=<public API> ./scripts/verify-run.sh <documented run>
local JCS/SHA-256/provider-signature recomputation from the public run response
cast chain-id, cast code, cast keccak, cast call getRun, and cast receipt against public X Layer testnet RPC
retried JSON-RPC eth_chainId against both configured public RPCs
```

## 12. Phase 0 acceptance gate

- [x] No product code, configuration, branch, database, contract, wallet, chain state, or deployment was changed.
- [x] Only `PROGRESS_PLAN.md` and this baseline report were written.
- [x] Deployed branches/commits and automatic-deployment behavior were identified.
- [x] The safe base and proposed isolated local branch were recorded.
- [x] The complete baseline suite was run and results were recorded honestly.
- [x] The existing paid Passport was independently checked without a paid action.
- [x] No secret values appear in the reports.

STOP: do not create the Phase 1 branch or begin PassportGate work in Phase 0.

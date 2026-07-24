# LaunchProof Azure candidate infrastructure

This directory contains the Phase 6 plan plus the approved Phase 7 read-only candidate controls. It does not move the Vercel frontend, live Supabase PostgreSQL, Railway writer, X Layer registry, settlements, or DNS.

## Architecture

```text
Vercel frontend (existing)
          |
          | exact HTTPS CORS origin
          v
Azure Container Apps environment (isolated candidate resource group)
  +-- read-only backend API (1 replica; no worker/indexer/payment/writer capability)
  +-- healthy paid fixture       (1 replica, distinct HTTPS origin)
  +-- invalid-output fixture     (1 replica, distinct HTTPS origin)
  +-- schema-drift fixture       (1 replica, distinct HTTPS origin)
  +-- timeout fixture            (1 replica, distinct HTTPS origin)
          |
          +-- isolated candidate Supabase PostgreSQL
          |     +-- SELECT-only runtime DATABASE_URL
          +-- existing X Layer testnet RPC / registry / USD₮0
          +-- official OKX Web3 facilitator

User-assigned identity
  +-- Key Vault Secrets User on candidate Key Vault
  +-- AcrPull on the separately approved candidate Basic ACR

Log Analytics: 30-day retention, immediate purge at 30 days, 1 GB/day safety cap
Optional Cost Management budget: alerts only; it does not stop charges
```

The Container Apps environment uses the Consumption workload profile. Every app has external HTTPS ingress, HTTP startup/readiness probes, TCP liveness, single active revision, `minReplicas=1`, and `maxReplicas=1`. Fixtures use the platform-minimum `0.25 vCPU / 0.5 GiB` combination; the backend begins at `0.5 vCPU / 1 GiB`. These are candidate values, not claimed Azure performance results. Phase 7 must run real cold/warm latency and memory tests before accepting or lowering them.

The backend and controlled fixtures have independent immutable provenance. `buildCommit` identifies a reachable immutable backend-source commit, while `fixtureBuildCommit` identifies the previously built signed fixture artifact. Each image must carry its corresponding full commit tag and an ACR-provided `sha256` digest. What-if and apply commands additionally require `buildCommit` to equal the checked-out `HEAD`, while later read-only audit can verify an already deployed ancestor after a documentation-only follow-up commit. Container App revision suffixes use the deployment commit, so an accepted fixture artifact can be rolled out again without reusing a historical Azure revision name. This permits a backend-only fix without silently changing the signed Launch Contract identity of an accepted fixture.

Microsoft documents the selected behaviors in [Container Apps health probes](https://learn.microsoft.com/azure/container-apps/health-probes), [Container Apps workload profiles](https://learn.microsoft.com/azure/container-apps/workload-profiles-overview), [managed identity image pulls](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull), [Key Vault-backed Container Apps secrets](https://learn.microsoft.com/rest/api/resource-manager/containerapps/container-apps/list-secrets), and [Bicep what-if](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if).

## Read-only boundary and deployment stages

`BACKEND_MODE=read-only` is a genuine application boundary. Configuration rejects x402, writer/target private keys, OKX facilitator credentials, leadership database settings, and execution bypasses. Runtime construction returns `ReadOnlyLeaderGuard` before a leadership session factory can be created. That guard has no start/acquire/poll/session surface and permanently rejects every writer capability. Startup skips indexing and all recovery/reconciliation loops. Mutating REST/MCP routes return 503 without a 402 challenge, and the repository wrapper rejects every write method. The candidate database login is separately restricted to `SELECT`.

The IaC supports two real modes:

1. `read-only`: the approved Phase 7 backend and fixtures may be deployed, but the backend receives only `backend-readonly-database-url`; it receives no leadership, writer, payer, or facilitator secret.
2. `active`: retained only for a future separately approved cutover. Bicep requires `writerCutoverApproved=true`; scripts additionally require explicit cost/cutover markers and `OLD_WRITER_DISABLED=yes`.

The `foundation` and `fixtures` script stages explicitly set `deployBackend=false`; the `readonly` stage sets `deployBackend=true` with `activationMode=read-only`. Phase 7 never invokes `cutover`.

## Files

- `bicep/resource-group.bicep`: subscription-scope dedicated resource group.
- `bicep/registry.bicep`: separately approved Basic ACR with admin credentials disabled.
- `bicep/main.bicep`: candidate foundation, identity, Key Vault, logging, budget, environment, apps, and configuration.
- `bicep/modules/container-app.bicep`: one hardened Container App definition.
- `bicep/modules/acr-pull.bicep`: `AcrPull` assignment on an existing registry.
- `parameters/*.example.json`: non-secret, visibly non-deployable examples.
- `key-vault-secret-names.json`: names only; never values.
- `scripts/validate.sh`: offline Bicep build, template inspection, parameter safety, Bash parsing, and ShellCheck when installed.
- `scripts/plan.sh`: renders an ARM plan without contacting Azure.
- `scripts/resource-group-what-if.sh`: authenticated, non-applying subscription-scope resource-group what-if.
- `scripts/what-if.sh`: authenticated, non-applying resource-group what-if.
- `scripts/registry-what-if.sh` / `scripts/deploy-registry.sh`: separately gated Basic ACR review and creation.
- `scripts/deploy.sh`: Phase 7-gated foundation/fixture/read-only operations; future cutover remains separately gated.
- `scripts/health-acceptance.sh`: read-only HTTPS health and deterministic-manifest checks.
- `scripts/rollback.sh`: Phase 7-gated Azure writer shutdown; never changes Railway.
- `COSTS.md`, `ROLLBACK.md`, and `WHAT_IF.md`: cost, recovery, and current what-if status.

## Phase 7 order of operations

1. Install Azure CLI 2.76.0 or newer and Bicep CLI.
2. Run `az login` interactively. The scripts never collect credentials.
3. If multiple subscriptions are enabled, review the printed list and export `AZURE_SUBSCRIPTION_ID`.
4. Verify the exact approved tenant, subscription, `centralindia` region, and dedicated resource group before any apply.
5. Run and review the resource-group and separately approved Basic ACR what-if plans.
6. Create the isolated Supabase project without linking the repository or touching the live project; apply Prisma migrations explicitly to its URL and create a SELECT-only runtime role.
7. Create the candidate resource group and ACR, then build all five images from a clean archive of the immutable commit using ACR Tasks.
8. Record registry-provided digests, fill an untracked non-secret parameter file, and run deployment-mode validation.
9. Run and review the complete resource-group what-if.
10. Deploy foundation, insert only approved secret values through Key Vault, deploy fixtures, and deploy the read-only backend.
11. Run health/configuration/Passport acceptance without a rehearsal, payment, wallet signature, or chain transaction. Stop before cutover.

## Offline validation

```bash
export BICEP_CLI=/path/to/bicep
infra/azure/scripts/validate.sh
infra/azure/scripts/plan.sh
```

The checked-in examples intentionally fail deployment-mode validation. This prevents an example from becoming a plausible live plan.

## Later non-applying what-if

```bash
infra/azure/scripts/resource-group-what-if.sh \
  <filled-resource-group-parameters.json> \
  <safe-output-file.json>

infra/azure/scripts/registry-what-if.sh \
  <existing-candidate-resource-group> \
  <filled-registry-parameters.json> \
  <safe-output-file.json>

infra/azure/scripts/what-if.sh \
  <existing-candidate-resource-group> \
  <filled-candidate-parameters.json> \
  <safe-output-file.json>
```

What-if is a preview, not a cost guarantee. Apply scripts require the exact approval markers in addition to reviewed plans.

## Key Vault values

Only secret names are committed. The read-only backend gets one isolated candidate Supabase URL whose database role has only `SELECT`. It never gets a leadership URL, registry writer key, target payer key, or facilitator credential. Fixtures use four existing stable provider identities; only the healthy paid fixture receives the approved OKX facilitator references. Do not generate production identities, put secrets in parameters, or print secret values.

The managed identity receives only Key Vault Secrets User and AcrPull. Key Vault uses RBAC, purge protection, and 90-day soft delete. Container App configuration contains only versionless Key Vault references; secret rotation does not require committing values.

## Explicit approvals

Apply commands remain locked behind exact local environment markers. The user approved the Phase 7 candidate charges/resources and separately approved a Basic ACR. No writer cutover is approved. The scripts cannot modify Vercel, Railway, wallets, X Layer, or the live Supabase project.

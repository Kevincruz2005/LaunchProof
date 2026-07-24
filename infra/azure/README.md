# LaunchProof Azure candidate infrastructure

This directory contains Phase 6 infrastructure-as-code only. It does not move the Vercel frontend, Supabase PostgreSQL, X Layer registry, settlements, or DNS. It never creates Azure Container Registry. Nothing here has been applied to Azure.

## Architecture

```text
Vercel frontend (existing)
          |
          | exact HTTPS CORS origin
          v
Azure Container Apps environment (candidate resource group)
  +-- backend API/worker/indexer (omitted in candidate mode; 1 replica after cutover)
  +-- healthy paid fixture       (1 replica, distinct HTTPS origin)
  +-- invalid-output fixture     (1 replica, distinct HTTPS origin)
  +-- schema-drift fixture       (1 replica, distinct HTTPS origin)
  +-- timeout fixture            (1 replica, distinct HTTPS origin)
          |
          +-- existing Supabase PostgreSQL
          |     +-- operational DATABASE_URL
          |     +-- direct/session leadership URL and Phase 5 advisory lock
          +-- existing X Layer testnet RPC / registry / USD₮0
          +-- official OKX Web3 facilitator

User-assigned identity
  +-- Key Vault Secrets User on candidate Key Vault
  +-- AcrPull on an existing ACR (no registry is created)

Log Analytics: 30-day retention, immediate purge at 30 days, 1 GB/day safety cap
Optional Cost Management budget: alerts only; it does not stop charges
```

The Container Apps environment uses the Consumption workload profile. Every app has external HTTPS ingress, HTTP startup/readiness probes, TCP liveness, single active revision, `minReplicas=1`, and `maxReplicas=1`. Fixtures use the platform-minimum `0.25 vCPU / 0.5 GiB` combination; the backend begins at `0.5 vCPU / 1 GiB`. These are candidate values, not claimed Azure performance results. Phase 7 must run real cold/warm latency and memory tests before accepting or lowering them.

Microsoft documents the selected behaviors in [Container Apps health probes](https://learn.microsoft.com/azure/container-apps/health-probes), [Container Apps workload profiles](https://learn.microsoft.com/azure/container-apps/workload-profiles-overview), [managed identity image pulls](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull), [Key Vault-backed Container Apps secrets](https://learn.microsoft.com/rest/api/resource-manager/containerapps/container-apps/list-secrets), and [Bicep what-if](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if).

## Writer safety and deployment stages

The current backend production entry point always performs chain preflight and joins writer-leadership election. It has no truthful read-only production mode. Phase 6 therefore does not invent an ignored `WRITER_ENABLED=false` variable.

The IaC supports two real modes:

1. `candidate`: infrastructure and four fixtures may be modeled, but the backend resource is omitted. This is publication-disabled by construction.
2. `active`: the backend is created with all production settings and the Phase 5 shared session advisory lock. Bicep requires `writerCutoverApproved=true`; scripts additionally require explicit Phase 7/cost/cutover approvals and `OLD_WRITER_DISABLED=yes`.

An Azure backend must never be started while the current Railway writer can operate. The safest pre-hackathon sequence is explicit stop-old, deploy/start Azure, validate, then route traffic. Rollback disables Azure ingress and scales it to zero before Railway is restarted. The shared Phase 5 leadership database remains defense in depth; it is not used to excuse simultaneous writer activation.

## Files

- `bicep/resource-group.bicep`: subscription-scope dedicated resource group.
- `bicep/main.bicep`: candidate foundation, identity, Key Vault, logging, budget, environment, apps, and configuration.
- `bicep/modules/container-app.bicep`: one hardened Container App definition.
- `bicep/modules/acr-pull.bicep`: `AcrPull` assignment on an existing registry.
- `parameters/*.example.json`: non-secret, visibly non-deployable examples.
- `key-vault-secret-names.json`: names only; never values.
- `scripts/validate.sh`: offline Bicep build, template inspection, parameter safety, Bash parsing, and ShellCheck when installed.
- `scripts/plan.sh`: renders an ARM plan without contacting Azure.
- `scripts/resource-group-what-if.sh`: authenticated, non-applying subscription-scope resource-group what-if.
- `scripts/what-if.sh`: authenticated, non-applying resource-group what-if.
- `scripts/deploy.sh`: Phase 7-gated foundation/fixture/cutover operations.
- `scripts/health-acceptance.sh`: read-only HTTPS health and deterministic-manifest checks.
- `scripts/rollback.sh`: Phase 7-gated Azure writer shutdown; never changes Railway.
- `COSTS.md`, `ROLLBACK.md`, and `WHAT_IF.md`: cost, recovery, and current what-if status.

## Prerequisites for a later Phase 7

1. Install Azure CLI 2.76.0 or newer and Bicep CLI.
2. Run `az login` interactively. The scripts never collect credentials.
3. If multiple subscriptions are enabled, review the printed list and export `AZURE_SUBSCRIPTION_ID`.
4. Choose a dedicated candidate resource group and region.
5. Select an existing safe ACR. If none exists, stop and request approval; these templates do not create one.
6. Build all five images from a clean immutable commit, tag with all 40 characters, push to the approved registry, and record registry-provided digests.
7. Copy the example parameter files outside version control, replace every `REPLACE_` marker, and run deployment-mode parameter validation.
8. Run subscription what-if for the resource group, then group what-if for `main.bicep` with `ProviderNoRbac` validation.
9. Review [COSTS.md](COSTS.md) and obtain one explicit approval for possible charges.
10. Only in Phase 7, create foundation, insert Key Vault secret values through an approved secret-management path, then deploy fixtures.
11. Stop and verify the old writer before the separately approved backend cutover.

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

infra/azure/scripts/what-if.sh \
  <existing-candidate-resource-group> \
  <filled-candidate-parameters.json> \
  <safe-output-file.json>
```

What-if is a preview, not a cost guarantee. Never replace it with `az deployment ... create` during Phase 6.

## Key Vault values

Only secret names are committed. Required values include two distinct Supabase URLs (ordinary pooled/compatible operational access and direct/session leadership access), separate registry writer and target payer keys, four stable fixture provider keys, and OKX facilitator credentials. Do not use generated production identities, put secrets in parameters, print them, or use the payout private key in the application.

The managed identity receives only Key Vault Secrets User and AcrPull. Key Vault uses RBAC, purge protection, and 90-day soft delete. Container App configuration contains only versionless Key Vault references; secret rotation does not require committing values.

## Explicit Phase 7 approval

No apply command is authorized by this directory. Phase 7 requires the user to approve possible Azure charges, the chosen subscription/registry/resource group, and the writer cutover. The scripts enforce separate exact approval markers and still cannot modify Vercel, Railway, Supabase, wallets, or X Layer.

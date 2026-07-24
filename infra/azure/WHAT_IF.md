# Azure Phase 7 what-if and apply record

Status on 2026-07-24: **approved read-only candidate deployed and accepted**.

## Authorized scope

- Subscription: `3207de1c-c619-4e20-bd21-90461932b9ce`
- Tenant: `289aabb0-9ade-4bd3-9018-c6e53b2e0c5c`
- Region: `centralindia`
- Resource group: `launchproof-phase7-candidate`
- Isolated branch: `upgrade/passportgate-phase1-20260719` (no upstream and not pushed)
- Deployed immutable source commit: `81d8bf43cc12942b0155563ae310cc86a3aa5acf`
- Activation mode: `read-only`

The user approved candidate resource creation and possible charges, separately approved a Basic ACR, approved the genuine read-only design, and approved removal of the unsupported Consumption workload-profile counts. The user did not authorize a writer cutover, Railway/Vercel changes, payments, transactions, a branch push, or use of the live Supabase project.

## Reviewed what-if

The final authenticated `ProviderNoRbac` resource-group what-if succeeded before the final deployment. It contained the same approved candidate boundary:

- five Container Apps;
- one Container Apps environment;
- one user-assigned managed identity;
- one RBAC Key Vault and its managed-identity secret-read assignment;
- one capped Log Analytics workspace;
- one monthly budget;
- the separately created ACR as `Ignore`; and
- the cross-scope `AcrPull` assignment as `Unsupported` in preview because the managed identity principal does not exist until apply.

There were no deletes, Azure database resources, writer resources, network cutovers, or changes outside the candidate resource group and approved existing ACR scope.

The first complete what-if returned `WorkloadProfilePropertyNotSupported` because Central India does not accept environment-level `minimumCount` or `maximumCount` on the Consumption profile. Nothing was applied from that failed preview. After the user replied `APPROVE CONSUMPTION PROFILE FIX`, only those unsupported environment-profile properties were removed. Per-app `minReplicas=1` and `maxReplicas=1` remain enforced.

## Created candidate resources

- Basic ACR: `launchproofp73207de1c` (admin and anonymous pull disabled)
- Container Apps environment: `launchproof-4n5cwi34-cae`
- Key Vault: `launchproof-4n5cwi34-kv`
- Log workspace: `launchproof-4n5cwi34-logs`
- Managed identity: `launchproof-identity`
- Backend: `https://launchproof-backend.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`
- Healthy fixture: `https://launchproof-fixture-healthy.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`
- Invalid-output fixture: `https://launchproof-fixture-invalid.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`
- Schema-drift fixture: `https://launchproof-fixture-drift.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`
- Timeout fixture: `https://launchproof-fixture-timeout.delightfultree-b2769bfb.centralindia.azurecontainerapps.io`
- Monthly resource-group budget: `launchproof-monthly-budget`, amount `10`

The candidate database is the isolated Supabase project `launchproof-phase7-candidate` (`nozauounvbtwpjxajifg`) in `ap-south-1`. All four existing Prisma migrations were applied. Runtime access uses a separate login whose transaction default is read-only and whose table privileges are SELECT-only; a real insert was rejected. The live LaunchProof Supabase project was never linked, connected, or modified.

## Immutable images

All images use the full source SHA as their tag and are pinned by registry digest:

| Workload | Digest |
| --- | --- |
| backend | `sha256:dc60ea7376bfd092d346ce9b23879c8b7c8e2e416c1a8c375d7c6cc3d4c622c8` |
| healthy fixture | `sha256:6ec47946037be0cb3a7cb08f45f3e9248a26a9a37395a933b49b38d055b38c59` |
| invalid-output fixture | `sha256:776d0afb8e0bf8a49eed062e7400827da8c1f24e9fa17c2154a61ba30c86d96d` |
| schema-drift fixture | `sha256:e6759e11d2a85f9af0087e0bd84e0f733a8bbc9ef9e943d5c179ce1bc3931db9` |
| timeout fixture | `sha256:80017cc481c6182a6a90a7a54f28fda46cc38c281da07d81fb4ec32c9c2b8d9d` |

Azure ACR Tasks are unavailable in this Azure for Students subscription (`TasksOperationsNotAllowed`). Images were therefore built locally with checksum-verified upstream BuildKit v0.31.2 and pushed directly to the approved ACR. This changes the builder only, not the source, Dockerfiles, tag/digest policy, or deployment boundary.

## Acceptance result

- All five apps are running, single-revision, externally HTTPS-addressed, and fixed at one minimum and maximum replica.
- Backend health reports `backend_mode=read-only`, database and registry reachable, x402 `disabled_read_only`, and writer leadership `disabled`.
- Backend configuration contains no registry-writer, target-payer, facilitator, or leadership credential/reference. Its only secret reference is the SELECT-only database URL from Key Vault.
- Temporary human Key Vault roles used for secret insertion/deployment preflight were removed.
- Mutating REST and MCP routes return HTTP 503 with `read_only_candidate` and no payment challenge.
- All four Launch Contracts are deterministic and pass strict schema, exact source revision, configured provider identity, same-origin endpoint, and declaration-signature checks.
- REST and MCP PassportGate results validate against the public schema. The exact Vercel origin passes CORS preflight; an untrusted origin is denied.
- Prior run `0xd348748baf9fc8cde21ea1b0bca66db65cc98b82ecd3c7b7299ca9d48b14aa1d` reconstructs without a database cache and independently verifies with every chain/hash/signature/payment/semantic field matching.
- The primary RPC reports chain 1952; the configured registry runtime hash and official test USD₮0 bytecode verify.
- The existing Railway service remains the sole writer-capable deployment and is healthy/payment-ready. Vercel remains reachable and unchanged.
- No payment, wallet signature, testnet transaction, registry publication, writer activation, or routing change was performed.

The official secondary endpoint `https://xlayertestrpc.okx.com/terigon` was still documented by OKX but reset connections from this workstation during the final probe. It remains configured behind the healthy official primary endpoint; it was not replaced with an unofficial RPC. Candidate health and all registry reconstruction used the primary successfully.

## Cost observation

The Basic ACR retail estimate observed before approval was approximately USD 0.1666/day plus storage/transfer. Container Apps, Key Vault operations, logging, ACR storage/pulls, and traffic may also incur charges. Supabase reports the candidate as Nano/free. The Azure budget query immediately after deployment reported amount `10` and current spend `0.0 INR`; billing data can lag and this is not a zero-cost guarantee.

## Commands used

Sensitive values were supplied only from protected local files or Key Vault and are intentionally omitted:

```text
az account show
infra/azure/scripts/resource-group-what-if.sh ...
infra/azure/scripts/registry-what-if.sh ...
infra/azure/scripts/what-if.sh launchproof-phase7-candidate ...
infra/azure/scripts/deploy-registry.sh ...
infra/azure/scripts/deploy.sh foundation ...
infra/azure/scripts/deploy.sh fixtures ...
infra/azure/scripts/deploy.sh readonly ...
infra/azure/scripts/verify-images.sh ...
infra/azure/scripts/health-acceptance.sh
pnpm check
```

Phase 7 stops with the candidate read-only. Writer cutover and Phase 8 remain unapproved.

# Azure what-if status

Status on 2026-07-22: **blocked before authentication**.

Observed locally:

- `az` is not installed or available on `PATH`.
- Therefore no Azure CLI version, login, tenant, subscription list, provider registration, candidate resource group, registry, quota, region support, or authorization could be inspected.
- No `az login` was attempted because it is interactive and the user did not need to authenticate merely to author offline IaC.
- No subscription was selected.
- No subscription-scope or resource-group what-if was run.
- No Azure resource was created, changed, queried, or deleted.

The precise next step, only after Phase 7 is explicitly approved, is:

1. Install Azure CLI 2.76.0 or newer.
2. Run `az login` interactively.
3. Run `az account list`; if multiple enabled subscriptions exist, ask the user to choose and export `AZURE_SUBSCRIPTION_ID`.
4. Inspect existing ACR availability and the candidate region's Container Apps support/quota.
5. Fill non-secret parameter files and validate image digests.
6. Run `scripts/resource-group-what-if.sh` for the subscription-scope dedicated resource group plan.
7. If the dedicated resource group already exists, run `scripts/what-if.sh` for `main.bicep` with `ProviderNoRbac`.
8. Record resource changes and costs, and ask once for approval if any resource can incur charges.

An offline Bicep compilation is not described as an Azure what-if result. It proves template syntax/type validity only.

# Azure what-if status

Status on 2026-07-24: **local validation complete; authenticated review not yet started**.

Observed locally:

- Azure CLI 2.87.0 is locally available.
- Bicep 0.45.15 compiles the resource group, separately approved Basic ACR, and read-only candidate templates under strict linting.
- No Azure account command has yet been run in this Phase 7 continuation, so tenant/subscription/authentication remains unverified.
- No subscription was selected.
- No subscription-scope or resource-group what-if was run.
- No Azure resource was created, changed, queried, or deleted.

The precise next step under the recorded Phase 7 approval is:

1. Run `az account show` and stop if its tenant/subscription differs from the explicitly approved values.
2. Inspect provider registration, resource-name availability, `centralindia` support/quota, and current candidate-resource state.
3. Run `scripts/resource-group-what-if.sh`.
4. After the resource group exists, run and review `scripts/registry-what-if.sh`; create only the separately approved Basic ACR.
5. Build immutable images, fill non-secret parameters with recorded digests, and run `scripts/what-if.sh`.
6. Record every change and deploy only the approved read-only candidate.

An offline Bicep compilation is not described as an Azure what-if result. It proves template syntax/type validity only.

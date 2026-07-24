#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RESOURCE_GROUP="${1:?usage: deploy-registry.sh <candidate-resource-group> <registry-parameters.json>}"
PARAMETERS_FILE="${2:?usage: deploy-registry.sh <candidate-resource-group> <registry-parameters.json>}"

require_phase7_apply_approval
require_azure_cli
select_authenticated_subscription
node "${AZURE_DIR}/scripts/validate-registry-parameters.mjs" "$PARAMETERS_FILE" deployment
[[ "${PHASE7_ACR_CREATE_APPROVED:-}" == "I_APPROVE_BASIC_ACR" ]] || fail "Basic ACR creation requires its separate approval marker"
[[ "${REGISTRY_WHAT_IF_REVIEWED:-}" == "yes" ]] || fail "set REGISTRY_WHAT_IF_REVIEWED=yes only after reviewing the current Basic ACR what-if"
[[ "$(az group exists --name "$RESOURCE_GROUP" --output tsv)" == "true" ]] || fail "dedicated candidate resource group does not exist"

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name launchproof-phase7-registry \
  --template-file "${AZURE_DIR}/bicep/registry.bicep" \
  --parameters "@$PARAMETERS_FILE" \
  --mode Incremental \
  --only-show-errors \
  --output json >"${AZURE_DIR}/launchproof-registry.last.json"

printf 'Approved Basic ACR deployment completed; admin credentials remain disabled.\n'

#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RESOURCE_GROUP="${1:?usage: what-if.sh <existing-candidate-resource-group> <deployment-parameters.json> [output.json]}"
PARAMETERS_FILE="${2:?usage: what-if.sh <existing-candidate-resource-group> <deployment-parameters.json> [output.json]}"
OUTPUT_FILE="${3:-${AZURE_DIR}/what-if.last.json}"

require_azure_cli
select_authenticated_subscription
require_command jq
activation_mode="$(parameter_value "$PARAMETERS_FILE" activationMode)"
validation_mode="deployment"
[[ "$activation_mode" == "active" ]] && validation_mode="active"
node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" "$validation_mode"
if [[ "$(az group exists --name "$RESOURCE_GROUP" --output tsv)" != "true" ]]; then
  fail "resource group '$RESOURCE_GROUP' does not exist; preview resource-group.bicep with 'az deployment sub what-if' after login, but do not create it without Phase 7 approval"
fi

az deployment group what-if \
  --resource-group "$RESOURCE_GROUP" \
  --name "launchproof-what-if-$(date -u +%Y%m%d%H%M%S)" \
  --template-file "$MAIN_BICEP" \
  --parameters "@$PARAMETERS_FILE" \
  --validation-level ProviderNoRbac \
  --result-format ResourceIdOnly \
  --no-pretty-print \
  --no-prompt \
  --output json >"$OUTPUT_FILE"

jq '{status,changeCount:(.changes // [] | length),changes:[(.changes // [])[] | {changeType,resourceId}]}' "$OUTPUT_FILE"
printf 'Non-applying what-if saved to %s; no deployment command was executed.\n' "$OUTPUT_FILE"

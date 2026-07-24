#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PARAMETERS_FILE="${1:?usage: bootstrap-resource-group.sh <resource-group-parameters.json>}"
require_phase7_apply_approval
node "${AZURE_DIR}/scripts/validate-resource-group-parameters.mjs" "$PARAMETERS_FILE" deployment
require_azure_cli
select_authenticated_subscription
require_command jq
[[ "${WHAT_IF_REVIEWED:-}" == "yes" ]] || fail "review 'az deployment sub what-if' for resource-group.bicep before bootstrap"

az deployment sub create \
  --location "$(parameter_value "$PARAMETERS_FILE" location)" \
  --name launchproof-resource-group \
  --template-file "$RESOURCE_GROUP_BICEP" \
  --parameters "@$PARAMETERS_FILE" \
  --only-show-errors \
  --output none
printf 'Dedicated candidate resource group created; no workload was deployed.\n'

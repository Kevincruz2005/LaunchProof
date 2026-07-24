#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RESOURCE_GROUP="${1:?usage: registry-what-if.sh <candidate-resource-group> <registry-parameters.json> [output.json]}"
PARAMETERS_FILE="${2:?usage: registry-what-if.sh <candidate-resource-group> <registry-parameters.json> [output.json]}"
OUTPUT_FILE="${3:-${AZURE_DIR}/registry.what-if.current.json}"

require_azure_cli
select_authenticated_subscription
require_command jq
node "${AZURE_DIR}/scripts/validate-registry-parameters.mjs" "$PARAMETERS_FILE" deployment
[[ "$(az group exists --name "$RESOURCE_GROUP" --output tsv)" == "true" ]] || fail "dedicated candidate resource group does not exist"

az deployment group what-if \
  --resource-group "$RESOURCE_GROUP" \
  --name launchproof-phase7-registry \
  --template-file "${AZURE_DIR}/bicep/registry.bicep" \
  --parameters "@$PARAMETERS_FILE" \
  --validation-level ProviderNoRbac \
  --no-pretty-print \
  --result-format FullResourcePayloads \
  --output json >"$OUTPUT_FILE"

jq -e '[.changes[] | select(.resourceId | test("/providers/Microsoft.ContainerRegistry/registries/"; "i") | not)] | length == 0' "$OUTPUT_FILE" >/dev/null ||
  fail "registry what-if contains a resource outside Microsoft.ContainerRegistry/registries"
jq -e '[.changes[] | select(.changeType == "Delete")] | length == 0' "$OUTPUT_FILE" >/dev/null ||
  fail "registry what-if contains a deletion"
printf 'Basic ACR what-if saved to %s; review it before apply.\n' "$OUTPUT_FILE"

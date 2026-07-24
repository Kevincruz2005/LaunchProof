#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PARAMETERS_FILE="${1:?usage: resource-group-what-if.sh <resource-group-parameters.json> [output.json]}"
OUTPUT_FILE="${2:-${AZURE_DIR}/resource-group-what-if.last.json}"

require_azure_cli
select_authenticated_subscription
require_command jq
node "${AZURE_DIR}/scripts/validate-resource-group-parameters.mjs" "$PARAMETERS_FILE" deployment

az deployment sub what-if \
  --location "$(parameter_value "$PARAMETERS_FILE" location)" \
  --name "launchproof-resource-group-what-if-$(date -u +%Y%m%d%H%M%S)" \
  --template-file "$RESOURCE_GROUP_BICEP" \
  --parameters "@$PARAMETERS_FILE" \
  --validation-level ProviderNoRbac \
  --result-format ResourceIdOnly \
  --no-pretty-print \
  --no-prompt \
  --output json >"$OUTPUT_FILE"

jq '{status,changeCount:(.changes // [] | length),changes:[(.changes // [])[] | {changeType,resourceId}]}' "$OUTPUT_FILE"
printf 'Non-applying resource-group what-if saved to %s; no deployment command was executed.\n' "$OUTPUT_FILE"

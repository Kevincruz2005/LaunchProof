#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PARAMETERS_FILE="${1:-${AZURE_DIR}/parameters/candidate.parameters.example.json}"
BICEP="${BICEP_CLI:-$(command -v bicep || true)}"
[[ -n "$BICEP" ]] || fail "Bicep CLI is required; set BICEP_CLI or install it using Microsoft's documented standalone installer"
require_command node
require_command jq

"$BICEP" --version
"$BICEP" build "$RESOURCE_GROUP_BICEP" --outfile /tmp/launchproof-resource-group.json
"$BICEP" build "$MAIN_BICEP" --outfile /tmp/launchproof-azure-main.json
node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" example
node "${AZURE_DIR}/scripts/validate-resource-group-parameters.mjs" "${AZURE_DIR}/parameters/resource-group.parameters.example.json" example
node "${AZURE_DIR}/tests/inspect-template.mjs" /tmp/launchproof-azure-main.json "$AZURE_DIR"
node "${AZURE_DIR}/tests/parameter-safety.mjs" "$AZURE_DIR"
node "${AZURE_DIR}/tests/resource-group-parameter-safety.mjs" "$AZURE_DIR"
node "${AZURE_DIR}/tests/health-acceptance.mjs" "$AZURE_DIR"

for script in "${AZURE_DIR}"/scripts/*.sh; do
  bash -n "$script"
done
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x -P "${AZURE_DIR}/scripts" "${AZURE_DIR}"/scripts/*.sh
else
  printf 'azure-iac: ShellCheck is unavailable; bash parser validation passed, but install ShellCheck before Phase 7.\n' >&2
fi

printf 'Azure IaC local validation passed without contacting Azure.\n'

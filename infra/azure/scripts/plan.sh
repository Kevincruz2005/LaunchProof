#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PARAMETERS_FILE="${1:-${AZURE_DIR}/parameters/candidate.parameters.example.json}"
BICEP="${BICEP_CLI:-$(command -v bicep || true)}"
[[ -n "$BICEP" ]] || fail "Bicep CLI is required"
OUTPUT="${2:-/tmp/launchproof-azure-plan.json}"

"$BICEP" build "$MAIN_BICEP" --outfile "$OUTPUT"
node "${AZURE_DIR}/tests/inspect-template.mjs" "$OUTPUT" "$AZURE_DIR"
node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" example
printf 'Rendered non-applying ARM plan: %s\n' "$OUTPUT"

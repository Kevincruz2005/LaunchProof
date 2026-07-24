#!/usr/bin/env bash
set -euo pipefail

AZURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC2034 # exported contract for scripts that source this file
MAIN_BICEP="${AZURE_DIR}/bicep/main.bicep"
# shellcheck disable=SC2034 # exported contract for scripts that source this file
RESOURCE_GROUP_BICEP="${AZURE_DIR}/bicep/resource-group.bicep"

fail() {
  printf 'azure-iac: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is not installed"
}

require_azure_cli() {
  require_command az
  local version
  version="$(az version --query '"azure-cli"' --output tsv 2>/dev/null)" || fail "Azure CLI version could not be read"
  node "${AZURE_DIR}/scripts/require-version.mjs" "$version" "2.76.0" || fail "Azure CLI 2.76.0 or newer is required for ProviderNoRbac what-if validation"
}

select_authenticated_subscription() {
  if ! az account show --output none >/dev/null 2>&1; then
    fail "Azure authentication is required. Run 'az login' interactively, then rerun; this script never logs in for you"
  fi
  local enabled_count
  enabled_count="$(az account list --query "[?state=='Enabled'] | length(@)" --output tsv)"
  if [[ -n "${AZURE_SUBSCRIPTION_ID:-}" ]]; then
    az account set --subscription "${AZURE_SUBSCRIPTION_ID}"
  elif [[ "$enabled_count" == "1" ]]; then
    AZURE_SUBSCRIPTION_ID="$(az account list --query "[?state=='Enabled'].id | [0]" --output tsv)"
    export AZURE_SUBSCRIPTION_ID
    az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  else
    az account list --query "[?state=='Enabled'].{name:name,id:id,tenantId:tenantId}" --output table
    fail "multiple or zero enabled subscriptions were found; choose one and export AZURE_SUBSCRIPTION_ID"
  fi
}

parameter_value() {
  local file="$1"
  local name="$2"
  jq -er --arg name "$name" '.parameters[$name].value' "$file"
}

require_phase7_apply_approval() {
  [[ "${PHASE7_AZURE_APPLY_APPROVED:-}" == "I_APPROVE_AZURE_CHARGES" ]] ||
    fail "apply is locked until Phase 7: set PHASE7_AZURE_APPLY_APPROVED=I_APPROVE_AZURE_CHARGES only after explicit cost approval"
}

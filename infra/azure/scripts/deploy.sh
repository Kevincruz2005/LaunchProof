#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

MODE="${1:-}"
RESOURCE_GROUP="${2:-}"
PARAMETERS_FILE="${3:-}"
[[ -n "$MODE" && -n "$RESOURCE_GROUP" && -n "$PARAMETERS_FILE" ]] ||
  fail "usage: deploy.sh <foundation|fixtures|readonly|cutover> <resource-group> <deployment-parameters.json>"
[[ "$MODE" =~ ^(foundation|fixtures|readonly|cutover)$ ]] || fail "unknown deployment mode"

require_phase7_apply_approval
require_azure_cli
select_authenticated_subscription
require_command jq
[[ "${WHAT_IF_REVIEWED:-}" == "yes" ]] || fail "set WHAT_IF_REVIEWED=yes only after reviewing a current ProviderNoRbac what-if and cost summary"
[[ "$(az group exists --name "$RESOURCE_GROUP" --output tsv)" == "true" ]] || fail "dedicated candidate resource group does not exist"

case "$MODE" in
  foundation)
    node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" deployment --require-current-head
    overrides=(activationMode=read-only writerCutoverApproved=false deployWorkloads=false deployBackend=false)
    ;;
  fixtures)
    node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" deployment --require-current-head
    overrides=(activationMode=read-only writerCutoverApproved=false deployWorkloads=true deployBackend=false)
    ;;
  readonly)
    node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" deployment --require-current-head
    overrides=(activationMode=read-only writerCutoverApproved=false deployWorkloads=true deployBackend=true)
    ;;
  cutover)
    node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" active --require-current-head
    [[ "${OLD_WRITER_DISABLED:-}" == "yes" ]] || fail "cutover refused: stop and health-check the Railway writer first, then set OLD_WRITER_DISABLED=yes"
    [[ "${PHASE7_WRITER_CUTOVER_APPROVED:-}" == "I_APPROVE_WRITER_CUTOVER" ]] || fail "cutover requires separate explicit writer approval"
    overrides=(activationMode=active writerCutoverApproved=true deployWorkloads=true deployBackend=true)
    ;;
esac

"${AZURE_DIR}/scripts/verify-images.sh" "$PARAMETERS_FILE" --require-current-head
key_vault_name="$(az deployment group show --resource-group "$RESOURCE_GROUP" --name launchproof-foundation --query properties.outputs.keyVaultName.value --output tsv 2>/dev/null || true)"
if [[ "$MODE" != "foundation" ]]; then
  [[ -n "$key_vault_name" ]] || fail "foundation deployment output was not found"
  secret_groups=(requiredForFixtures)
  [[ "$MODE" == "readonly" ]] && secret_groups+=(requiredForReadOnlyBackend)
  [[ "$MODE" == "cutover" ]] && secret_groups+=(requiredForBackendCutover)
  for secret_group in "${secret_groups[@]}"; do
    while IFS= read -r secret_name; do
      az keyvault secret show --vault-name "$key_vault_name" --name "$secret_name" --query id --output none >/dev/null
    done < <(jq -r --arg group "$secret_group" '.[$group][]' "${AZURE_DIR}/key-vault-secret-names.json")
  done
fi

deployment_name="launchproof-${MODE}"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$deployment_name" \
  --template-file "$MAIN_BICEP" \
  --parameters "@$PARAMETERS_FILE" "${overrides[@]}" \
  --mode Incremental \
  --only-show-errors \
  --output json >"${AZURE_DIR}/${deployment_name}.last.json"

printf 'Deployment %s completed. Run health-acceptance.sh before changing any external routing.\n' "$deployment_name"

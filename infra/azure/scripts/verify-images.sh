#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PARAMETERS_FILE="${1:?usage: verify-images.sh <deployment-parameters.json>}"
require_command jq
activation_mode="$(parameter_value "$PARAMETERS_FILE" activationMode)"
validation_mode="deployment"
[[ "$activation_mode" == "active" ]] && validation_mode="active"
node "${AZURE_DIR}/scripts/validate-parameters.mjs" "$PARAMETERS_FILE" "$validation_mode"
require_azure_cli
select_authenticated_subscription

registry_name="$(parameter_value "$PARAMETERS_FILE" containerRegistryName)"
for parameter in backendImage healthyFixtureImage invalidOutputFixtureImage schemaDriftFixtureImage timeoutFixtureImage; do
  image="$(parameter_value "$PARAMETERS_FILE" "$parameter")"
  repository_and_digest="${image#*/}"
  repository_with_tag="${repository_and_digest%@*}"
  repository="${repository_with_tag%:*}"
  digest="${repository_and_digest##*@}"
  az acr manifest show-metadata \
    --registry "$registry_name" \
    --name "${repository}@${digest}" \
    --query '{digest:digest,createdTime:createdTime}' \
    --output none
done
printf 'All five immutable image digests exist in the approved existing ACR.\n'

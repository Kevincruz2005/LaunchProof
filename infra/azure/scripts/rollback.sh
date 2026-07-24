#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RESOURCE_GROUP="${1:?usage: rollback.sh <resource-group> <backend-app-name>}"
BACKEND_APP="${2:?usage: rollback.sh <resource-group> <backend-app-name>}"
[[ "${PHASE7_ROLLBACK_APPROVED:-}" == "I_APPROVE_AZURE_WRITER_STOP" ]] || fail "rollback requires explicit Azure writer-stop approval"
require_azure_cli
select_authenticated_subscription

az containerapp ingress disable --resource-group "$RESOURCE_GROUP" --name "$BACKEND_APP" --output none
az containerapp update --resource-group "$RESOURCE_GROUP" --name "$BACKEND_APP" --min-replicas 0 --max-replicas 1 --output none
printf 'Azure backend ingress is disabled and scale-down requested.\n'
printf 'Verify zero running replicas and leadership-lock release before restarting Railway; this script intentionally does not mutate Railway.\n'

#!/usr/bin/env sh
set -eu

RUN_ID="${1:-}"
: "${RUN_ID:?usage: ./scripts/verify-run.sh RUN_ID}"
: "${PUBLIC_API_BASE_URL:?PUBLIC_API_BASE_URL is required}"

response="$(curl -fsS "${PUBLIC_API_BASE_URL%/}/verify/$RUN_ID")"
printf '%s\n' "$response" | jq .
printf '%s\n' "$response" | jq -e '
  .chain_record_found == true and
  .evidence_hash_match == true and
  .manifest_hash_match == true and
  .input_hash_match == true and
  .result_hash_match == true and
  .provider_signature_match == true and
  .gate_status_match == true and
  .storage_match == true and
  .link_fields_match == true and
  .match == true
' >/dev/null
printf 'LaunchProof chain evidence matches for %s\n' "$RUN_ID"

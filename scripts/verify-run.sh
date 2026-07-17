#!/usr/bin/env sh
set -eu

RUN_ID="${1:-}"
: "${RUN_ID:?usage: ./scripts/verify-run.sh RUN_ID}"
if [ -z "${PUBLIC_API_BASE_URL:-}" ] && [ -f .env ]; then
  PUBLIC_API_BASE_URL="$(node -e '
    const fs = require("fs");
    const line = fs.readFileSync(".env", "utf8").split(/\r?\n/).find(value => value.startsWith("PUBLIC_API_BASE_URL="));
    process.stdout.write(line ? line.slice(line.indexOf("=") + 1).replace(/^"(.*)"$/, "$1") : "");
  ')"
fi
: "${PUBLIC_API_BASE_URL:?PUBLIC_API_BASE_URL is required in the environment or .env}"

run_response="$(curl -fsS "${PUBLIC_API_BASE_URL%/}/runs/$RUN_ID")"
printf '%s\n' "$run_response" | jq -e '
  .state == "complete" and
  .canonical_evidence.execution_mode == "testnet" and
  .canonical_evidence.network == "eip155:1952" and
  (.label == "fixture" or .label == "external") and
  .canonical_evidence.label == .label and
  .passport_status == "verified" and
  ([.gates[]] | all(. == "pass")) and
  .payment.status == "settled" and
  .payment.network == "eip155:1952" and
  .payment.settlement_transaction != null and
  .target_payment.status == "settled" and
  .target_payment.network == "eip155:1952" and
  .target_payment.settlement_transaction != null and
  .chain.published == true and
  .chain.evidence_transaction_hash != null
' >/dev/null

response="$(curl -fsS "${PUBLIC_API_BASE_URL%/}/verify/$RUN_ID")"
printf '%s\n' "$response" | jq .
printf '%s\n' "$response" | jq -e '
  .chain_record_found == true and
  .canonical_jcs_match == true and
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
printf 'Both x402 payments and the registry publication are settled on eip155:1952.\n'

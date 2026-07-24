#!/usr/bin/env bash
set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || { printf 'health-acceptance: missing %s\n' "$1" >&2; exit 1; }
}
require curl
require jq
require sha256sum

BACKEND_ORIGIN="${BACKEND_ORIGIN:-}"
HEALTHY_ORIGIN="${HEALTHY_ORIGIN:?set HEALTHY_ORIGIN}"
INVALID_OUTPUT_ORIGIN="${INVALID_OUTPUT_ORIGIN:?set INVALID_OUTPUT_ORIGIN}"
SCHEMA_DRIFT_ORIGIN="${SCHEMA_DRIFT_ORIGIN:?set SCHEMA_DRIFT_ORIGIN}"
TIMEOUT_ORIGIN="${TIMEOUT_ORIGIN:?set TIMEOUT_ORIGIN}"

origins=("${HEALTHY_ORIGIN%/}" "${INVALID_OUTPUT_ORIGIN%/}" "${SCHEMA_DRIFT_ORIGIN%/}" "${TIMEOUT_ORIGIN%/}")
[[ "$(printf '%s\n' "${origins[@]}" | sort -u | wc -l)" == "4" ]] || { printf 'fixture origins must be distinct\n' >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for index in "${!origins[@]}"; do
  origin="${origins[$index]}"
  [[ "$origin" == https://* ]] || { printf 'fixture origin must use HTTPS\n' >&2; exit 1; }
  curl --fail --silent --show-error --max-time 20 "$origin/healthz" >"$tmp/health-$index.json"
  jq -e '.status == "ok" and .fixture == true and .network == "eip155:1952" and .x402 != null' "$tmp/health-$index.json" >/dev/null
  curl --fail --silent --show-error --max-time 20 "$origin/.well-known/launch-contract.json" >"$tmp/contract-a-$index.json"
  curl --fail --silent --show-error --max-time 20 "$origin/.well-known/launch-contract.json" >"$tmp/contract-b-$index.json"
  jq -S . "$tmp/contract-a-$index.json" >"$tmp/contract-a-$index.canonical"
  jq -S . "$tmp/contract-b-$index.json" >"$tmp/contract-b-$index.canonical"
  [[ "$(sha256sum "$tmp/contract-a-$index.canonical" | cut -d' ' -f1)" == "$(sha256sum "$tmp/contract-b-$index.canonical" | cut -d' ' -f1)" ]] || {
    printf 'fixture %s returned a nondeterministic Launch Contract\n' "$origin" >&2
    exit 1
  }
done

jq -e '.x402 == true' "$tmp/health-0.json" >/dev/null
for index in 1 2 3; do jq -e '.x402 == false' "$tmp/health-$index.json" >/dev/null; done

if [[ -n "$BACKEND_ORIGIN" ]]; then
  [[ "$BACKEND_ORIGIN" == https://* ]] || { printf 'backend origin must use HTTPS\n' >&2; exit 1; }
  curl --fail --silent --show-error --max-time 30 "${BACKEND_ORIGIN%/}/healthz" >"$tmp/backend-health.json"
  jq -e '.backend_mode == "read-only" and .dependencies.database == "reachable" and .dependencies.registry == "reachable" and .dependencies.x402 == "disabled_read_only" and .dependencies.writer_leadership.state == "disabled"' "$tmp/backend-health.json" >/dev/null
fi

printf 'Read-only Azure health/manifest acceptance passed. No payment or rehearsal was executed.\n'

#!/usr/bin/env bash

umask 077
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
PORTS=(4101 4102 4103 4104)
VARIANTS=(healthy invalid-output schema-drift timeout)
ENV_PREFIXES=(HEALTHY INVALID_OUTPUT SCHEMA_DRIFT TIMEOUT)
DIRS=(
  "$REPO_ROOT/fixtures/invoice-normalizer-healthy"
  "$REPO_ROOT/fixtures/invoice-normalizer-invalid-output"
  "$REPO_ROOT/fixtures/invoice-normalizer-schema-drift"
  "$REPO_ROOT/fixtures/invoice-normalizer-timeout"
)
CHILD_PIDS=()
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/launchproof-fixtures.XXXXXX")"

env_value() {
  local name="$1"
  local inherited="${!name-}"
  if [[ -n "$inherited" ]]; then
    printf '%s' "$inherited"
    return
  fi
  [[ -f "$ENV_FILE" ]] || return 0
  local value
  value="$(awk -v key="$name" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$ENV_FILE")"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}

require_value() {
  local name="$1"
  local value
  value="$(env_value "$name")"
  if [[ -z "$value" ]]; then
    printf 'ERROR: %s is required in the environment or .env\n' "$name" >&2
    return 1
  fi
  printf '%s' "$value"
}

generate_fixture_key() {
  (
    cd "$REPO_ROOT/fixtures/runtime"
    node --input-type=module --eval 'import { generatePrivateKey } from "viem/accounts"; process.stdout.write(generatePrivateKey())'
  )
}

cleanup_fixtures() {
  local status=$?
  trap - EXIT INT TERM
  for pid in "${CHILD_PIDS[@]-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  if [[ -n "${NGROK_CONFIG:-}" && -f "$NGROK_CONFIG" ]]; then
    : >"$NGROK_CONFIG"
    rm -f "$NGROK_CONFIG"
  fi
  if [[ $status -ne 0 ]]; then
    printf 'Fixture startup failed. Logs are in %s\n' "$RUN_DIR" >&2
  fi
  exit "$status"
}

prepare_fixture_settings() {
  FIXTURE_MODE="${1:-public}"
  [[ -f "$ENV_FILE" ]] || { printf 'ERROR: copy .env.example to .env first\n' >&2; return 1; }
  command -v node >/dev/null || { printf 'ERROR: node is required\n' >&2; return 1; }
  command -v curl >/dev/null || { printf 'ERROR: curl is required\n' >&2; return 1; }
  for dir in "${DIRS[@]}"; do
    [[ -f "$dir/dist/index.js" ]] || {
      printf 'ERROR: %s/dist/index.js is missing; run pnpm fixtures:build first\n' "$dir" >&2
      return 1
    }
  done

  SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    if [[ "$FIXTURE_MODE" == "public" ]]; then
      printf 'ERROR: public signed fixtures require a clean committed worktree so SOURCE_REVISION identifies the exact code\n' >&2
      return 1
    fi
    printf 'WARNING: local-only fixtures are running from a dirty worktree; do not publish or present this run as committed evidence.\n' >&2
  fi
  XLAYER_CHAIN_ID_VALUE="$(require_value XLAYER_CHAIN_ID)"
  XLAYER_TESTNET_VALUE="$(require_value XLAYER_TESTNET)"
  ALLOW_XLAYER_MAINNET_VALUE="$(require_value ALLOW_XLAYER_MAINNET)"
  XLAYER_NETWORK_VALUE="$(require_value XLAYER_NETWORK)"
  XLAYER_USDT0_ADDRESS_VALUE="$(require_value XLAYER_USDT0_ADDRESS)"
  NODE_ENV_VALUE="$(env_value NODE_ENV)"
  NODE_ENV_VALUE="${NODE_ENV_VALUE:-development}"
  FIXTURE_X402_ENABLED_VALUE="$(env_value FIXTURE_X402_ENABLED)"
  FIXTURE_X402_ENABLED_VALUE="${FIXTURE_X402_ENABLED_VALUE:-false}"
  [[ "$FIXTURE_X402_ENABLED_VALUE" == "true" || "$FIXTURE_X402_ENABLED_VALUE" == "false" ]] || {
    printf 'ERROR: FIXTURE_X402_ENABLED must be true or false\n' >&2
    return 1
  }
  FIXTURE_PAYMENT_RECIPIENT_VALUE="$(env_value FIXTURE_PAYMENT_RECIPIENT)"
  FIXTURE_PAYMENT_AMOUNT_VALUE="$(require_value FIXTURE_PAYMENT_AMOUNT_ATOMIC)"
  [[ "$FIXTURE_PAYMENT_AMOUNT_VALUE" =~ ^[0-9]+$ && ${#FIXTURE_PAYMENT_AMOUNT_VALUE} -le 6 ]] && (( 10#$FIXTURE_PAYMENT_AMOUNT_VALUE >= 1 && 10#$FIXTURE_PAYMENT_AMOUNT_VALUE <= 100000 )) || {
    printf 'ERROR: FIXTURE_PAYMENT_AMOUNT_ATOMIC must be between 1 and 100000\n' >&2
    return 1
  }
  OKX_API_KEY_VALUE="$(env_value OKX_API_KEY)"
  OKX_SECRET_KEY_VALUE="$(env_value OKX_SECRET_KEY)"
  OKX_PASSPHRASE_VALUE="$(env_value OKX_PASSPHRASE)"
  OKX_BASE_URL_VALUE="$(require_value OKX_BASE_URL)"
  if [[ "$FIXTURE_X402_ENABLED_VALUE" == "true" ]]; then
    [[ "$FIXTURE_PAYMENT_RECIPIENT_VALUE" =~ ^0x[0-9a-fA-F]{40}$ && ! "$FIXTURE_PAYMENT_RECIPIENT_VALUE" =~ ^0x0{40}$ ]] || {
      printf 'ERROR: paid fixture requires a nonzero FIXTURE_PAYMENT_RECIPIENT\n' >&2
      return 1
    }
    [[ -n "$OKX_API_KEY_VALUE" && -n "$OKX_SECRET_KEY_VALUE" && -n "$OKX_PASSPHRASE_VALUE" ]] || {
      printf 'ERROR: paid fixture requires OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE\n' >&2
      return 1
    }
  fi

  PRIVATE_KEYS=()
  local index key_name key
  for index in 0 1 2 3; do
    key_name="FIXTURE_${ENV_PREFIXES[$index]}_PROVIDER_PRIVATE_KEY"
    key="$(env_value "$key_name")"
    if [[ -z "$key" ]]; then
      if [[ "$FIXTURE_MODE" == "public" ]]; then
        printf 'ERROR: public fixture %s requires %s from the fresh key generator\n' "${VARIANTS[$index]}" "$key_name" >&2
        return 1
      fi
      key="$(generate_fixture_key)"
      printf 'Using an ephemeral, unprinted key for %s (run scripts/generate-testnet-keys.mjs for stable identity).\n' "${VARIANTS[$index]}"
    fi
    [[ "$key" =~ ^0x[0-9a-fA-F]{64}$ ]] || { printf 'ERROR: %s is not a private key\n' "$key_name" >&2; return 1; }
    PRIVATE_KEYS+=("$key")
  done
  [[ "${PRIVATE_KEYS[0]}" != "${PRIVATE_KEYS[1]}" && "${PRIVATE_KEYS[0]}" != "${PRIVATE_KEYS[2]}" && "${PRIVATE_KEYS[0]}" != "${PRIVATE_KEYS[3]}" && "${PRIVATE_KEYS[1]}" != "${PRIVATE_KEYS[2]}" && "${PRIVATE_KEYS[1]}" != "${PRIVATE_KEYS[3]}" && "${PRIVATE_KEYS[2]}" != "${PRIVATE_KEYS[3]}" ]] || {
    printf 'ERROR: every fixture must use a distinct provider key\n' >&2
    return 1
  }
}

start_fixture_processes() {
  PUBLIC_URLS=("$@")
  [[ ${#PUBLIC_URLS[@]} -eq 4 ]] || { printf 'ERROR: four explicit fixture URLs are required\n' >&2; return 1; }
  [[ "${PUBLIC_URLS[0]%/}" != "${PUBLIC_URLS[1]%/}" && "${PUBLIC_URLS[0]%/}" != "${PUBLIC_URLS[2]%/}" && "${PUBLIC_URLS[0]%/}" != "${PUBLIC_URLS[3]%/}" && "${PUBLIC_URLS[1]%/}" != "${PUBLIC_URLS[2]%/}" && "${PUBLIC_URLS[1]%/}" != "${PUBLIC_URLS[3]%/}" && "${PUBLIC_URLS[2]%/}" != "${PUBLIC_URLS[3]%/}" ]] || {
    printf 'ERROR: every fixture requires a distinct public origin\n' >&2
    return 1
  }
  local index
  if [[ "$FIXTURE_MODE" == "public" ]]; then
    for index in 0 1 2 3; do
      [[ "${PUBLIC_URLS[$index]}" == https://* ]] || { printf 'ERROR: public fixture URLs must use HTTPS\n' >&2; return 1; }
    done
  fi
  for index in 0 1 2 3; do
    (
      export NODE_ENV="$NODE_ENV_VALUE"
      export PORT="${PORTS[$index]}"
      export FIXTURE_BIND_HOST="127.0.0.1"
      export PUBLIC_BASE_URL="${PUBLIC_URLS[$index]%/}"
      export SOURCE_REVISION
      export FIXTURE_PROVIDER_PRIVATE_KEY="${PRIVATE_KEYS[$index]}"
      export XLAYER_CHAIN_ID="$XLAYER_CHAIN_ID_VALUE"
      export XLAYER_TESTNET="$XLAYER_TESTNET_VALUE"
      export ALLOW_XLAYER_MAINNET="$ALLOW_XLAYER_MAINNET_VALUE"
      export XLAYER_NETWORK="$XLAYER_NETWORK_VALUE"
      export XLAYER_USDT0_ADDRESS="$XLAYER_USDT0_ADDRESS_VALUE"
      export PAYMENT_AMOUNT_ATOMIC="$FIXTURE_PAYMENT_AMOUNT_VALUE"
      export OKX_BASE_URL="$OKX_BASE_URL_VALUE"
      export X402_ENABLED="false"
      unset PAYMENT_RECIPIENT OKX_API_KEY OKX_SECRET_KEY OKX_PASSPHRASE
      if [[ $index -eq 0 && "$FIXTURE_X402_ENABLED_VALUE" == "true" ]]; then
        export X402_ENABLED="true"
        export PAYMENT_RECIPIENT="$FIXTURE_PAYMENT_RECIPIENT_VALUE"
        export OKX_API_KEY="$OKX_API_KEY_VALUE"
        export OKX_SECRET_KEY="$OKX_SECRET_KEY_VALUE"
        export OKX_PASSPHRASE="$OKX_PASSPHRASE_VALUE"
      fi
      exec node "${DIRS[$index]}/dist/index.js"
    ) >"$RUN_DIR/fixture-${VARIANTS[$index]}.log" 2>&1 &
    CHILD_PIDS+=("$!")
  done
}

wait_for_fixture_processes() {
  local index attempt
  for index in 0 1 2 3; do
    for attempt in {1..40}; do
      if curl -fsS --max-time 2 "http://127.0.0.1:${PORTS[$index]}/healthz" >/dev/null 2>&1; then break; fi
      if ! kill -0 "${CHILD_PIDS[$(( ${#CHILD_PIDS[@]} - 4 + index ))]}" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if ! curl -fsS --max-time 2 "http://127.0.0.1:${PORTS[$index]}/healthz" >/dev/null 2>&1; then
      printf 'ERROR: %s fixture failed on port %s\n' "${VARIANTS[$index]}" "${PORTS[$index]}" >&2
      tail -n 20 "$RUN_DIR/fixture-${VARIANTS[$index]}.log" >&2 || true
      return 1
    fi
  done
}

verify_and_export_fixtures() {
  local index manifest_url output address host expected_payment_mode
  PROVIDER_ADDRESSES=()
  HOSTS=()
  for index in 0 1 2 3; do
    manifest_url="${PUBLIC_URLS[$index]%/}/.well-known/launch-contract.json"
    expected_payment_mode="none"
    if [[ $index -eq 0 && "$FIXTURE_X402_ENABLED_VALUE" == "true" ]]; then expected_payment_mode="x402_optional"; fi
    output="$(node "$REPO_ROOT/scripts/verify-fixture-manifest.mjs" \
      "$manifest_url" \
      "$SOURCE_REVISION" \
      "${PUBLIC_URLS[$index]%/}" \
      "${VARIANTS[$index]}" \
      "$XLAYER_NETWORK_VALUE" \
      "$XLAYER_USDT0_ADDRESS_VALUE" \
      "$expected_payment_mode" \
      "$FIXTURE_PAYMENT_RECIPIENT_VALUE" \
      "$FIXTURE_PAYMENT_AMOUNT_VALUE")" || return 1
    address="$(printf '%s' "$output" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).provider_address))')"
    PROVIDER_ADDRESSES+=("$address")
    host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "${PUBLIC_URLS[$index]}")"
    HOSTS+=("$host")
    printf '%-15s %s (%s)\n' "${VARIANTS[$index]}" "${PUBLIC_URLS[$index]}" "$address"
  done
  [[ "${PROVIDER_ADDRESSES[0]}" != "${PROVIDER_ADDRESSES[1]}" && "${PROVIDER_ADDRESSES[0]}" != "${PROVIDER_ADDRESSES[2]}" && "${PROVIDER_ADDRESSES[0]}" != "${PROVIDER_ADDRESSES[3]}" && "${PROVIDER_ADDRESSES[1]}" != "${PROVIDER_ADDRESSES[2]}" && "${PROVIDER_ADDRESSES[1]}" != "${PROVIDER_ADDRESSES[3]}" && "${PROVIDER_ADDRESSES[2]}" != "${PROVIDER_ADDRESSES[3]}" ]] || {
    printf 'ERROR: fixture provider addresses are not unique\n' >&2
    return 1
  }
  local allowlist
  allowlist="$(IFS=,; printf '%s' "${HOSTS[*]}")"
  node "$REPO_ROOT/scripts/update-env.mjs" "$ENV_FILE" \
    FIXTURE_HEALTHY_URL "${PUBLIC_URLS[0]}" \
    FIXTURE_INVALID_OUTPUT_URL "${PUBLIC_URLS[1]}" \
    FIXTURE_SCHEMA_DRIFT_URL "${PUBLIC_URLS[2]}" \
    FIXTURE_TIMEOUT_URL "${PUBLIC_URLS[3]}" \
    FIXTURE_HEALTHY_PROVIDER_ADDRESS "${PROVIDER_ADDRESSES[0]}" \
    FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS "${PROVIDER_ADDRESSES[1]}" \
    FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS "${PROVIDER_ADDRESSES[2]}" \
    FIXTURE_TIMEOUT_PROVIDER_ADDRESS "${PROVIDER_ADDRESSES[3]}" \
    TARGET_ALLOWLIST "$allowlist"
  if [[ "$FIXTURE_MODE" == "public" ]]; then
    node "$REPO_ROOT/scripts/update-env.mjs" "$ENV_FILE" BUILD_COMMIT_SHA "$SOURCE_REVISION"
  fi
  printf 'Updated explicit fixture URLs, addresses, and allowlist in .env (source %s).\n' "$SOURCE_REVISION"
}

wait_for_shutdown() {
  printf 'Fixtures are running. Press Ctrl+C to stop only the processes started by this script.\n'
  wait
}

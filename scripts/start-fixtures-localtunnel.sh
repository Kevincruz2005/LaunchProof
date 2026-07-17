#!/usr/bin/env bash
# Opens four independent LocalTunnel endpoints, then starts one signed fixture per endpoint.

set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/fixture-tunnel-common.sh"
trap cleanup_fixtures EXIT INT TERM

prepare_fixture_settings public
command -v pnpm >/dev/null || { printf 'ERROR: pnpm is required (enable Corepack as described in setup.md)\n' >&2; exit 1; }
pnpm --dir "$REPO_ROOT" exec lt --help >/dev/null 2>&1 || {
  printf 'ERROR: pinned localtunnel is not installed; run pnpm install --frozen-lockfile\n' >&2
  exit 1
}

for index in 0 1 2 3; do
  pnpm --dir "$REPO_ROOT" exec lt --port "${PORTS[$index]}" --local-host 127.0.0.1 >"$RUN_DIR/localtunnel-${PORTS[$index]}.log" 2>&1 &
  CHILD_PIDS+=("$!")
done

PUBLIC_URLS=("" "" "" "")
for attempt in {1..120}; do
  ready=true
  for index in 0 1 2 3; do
    if [[ -z "${PUBLIC_URLS[$index]}" ]]; then
      PUBLIC_URLS[$index]="$(sed -nE 's/.*(https:\/\/[^ ]+).*/\1/p' "$RUN_DIR/localtunnel-${PORTS[$index]}.log" | head -n 1)"
    fi
    [[ -n "${PUBLIC_URLS[$index]}" ]] || ready=false
  done
  [[ "$ready" == true ]] && break
  sleep 0.25
done
for index in 0 1 2 3; do
  [[ -n "${PUBLIC_URLS[$index]}" ]] || {
    printf 'ERROR: LocalTunnel did not provide a URL for port %s\n' "${PORTS[$index]}" >&2
    tail -n 20 "$RUN_DIR/localtunnel-${PORTS[$index]}.log" >&2 || true
    exit 1
  }
done

start_fixture_processes "${PUBLIC_URLS[@]}"
wait_for_fixture_processes
verify_and_export_fixtures
wait_for_shutdown

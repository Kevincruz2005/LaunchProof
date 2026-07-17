#!/usr/bin/env bash
# Starts one ngrok agent with four named tunnels, then one signed fixture per endpoint.

set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/fixture-tunnel-common.sh"
trap cleanup_fixtures EXIT INT TERM

prepare_fixture_settings public
command -v ngrok >/dev/null || { printf 'ERROR: ngrok is not installed or not in PATH\n' >&2; exit 1; }
NGROK_AUTHTOKEN_VALUE="$(require_value NGROK_AUTHTOKEN)"
NGROK_CONFIG="$RUN_DIR/ngrok.yml"
umask 077
{
  printf 'version: "2"\n'
  printf 'authtoken: %s\n' "$NGROK_AUTHTOKEN_VALUE"
  printf 'tunnels:\n'
  for index in 0 1 2 3; do
    printf '  %s:\n    proto: http\n    addr: 127.0.0.1:%s\n' "${VARIANTS[$index]}" "${PORTS[$index]}"
  done
} >"$NGROK_CONFIG"
chmod 600 "$NGROK_CONFIG"

ngrok start --all --config "$NGROK_CONFIG" --log stdout >"$RUN_DIR/ngrok.log" 2>&1 &
CHILD_PIDS+=("$!")

PUBLIC_URLS=("" "" "" "")
for attempt in {1..120}; do
  tunnel_json="$(curl -fsS --max-time 1 http://127.0.0.1:4040/api/tunnels 2>/dev/null || true)"
  if [[ -n "$tunnel_json" ]]; then
    for index in 0 1 2 3; do
      PUBLIC_URLS[$index]="$(printf '%s' "$tunnel_json" | node -e '
        let body = "";
        process.stdin.on("data", chunk => body += chunk).on("end", () => {
          const port = process.argv[1];
          const tunnel = JSON.parse(body).tunnels.find(item => item.proto === "https" && String(item.config?.addr ?? "").endsWith(`:${port}`));
          process.stdout.write(tunnel?.public_url ?? "");
        });
      ' "${PORTS[$index]}")"
    done
  fi
  [[ -n "${PUBLIC_URLS[0]}" && -n "${PUBLIC_URLS[1]}" && -n "${PUBLIC_URLS[2]}" && -n "${PUBLIC_URLS[3]}" ]] && break
  sleep 0.25
done
for index in 0 1 2 3; do
  [[ -n "${PUBLIC_URLS[$index]}" ]] || {
    printf 'ERROR: ngrok did not provide four HTTPS tunnels; your account must allow four simultaneous endpoints\n' >&2
    tail -n 30 "$RUN_DIR/ngrok.log" >&2 || true
    exit 1
  }
done

start_fixture_processes "${PUBLIC_URLS[@]}"
wait_for_fixture_processes
verify_and_export_fixtures
wait_for_shutdown

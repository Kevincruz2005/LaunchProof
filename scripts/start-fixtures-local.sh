#!/usr/bin/env bash
# Deterministic no-DNS fixture mode for local development and integration tests.

set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/fixture-tunnel-common.sh"
trap cleanup_fixtures EXIT INT TERM

prepare_fixture_settings local
PUBLIC_URLS=(
  "http://127.0.0.1:4101"
  "http://127.0.0.1:4102"
  "http://127.0.0.1:4103"
  "http://127.0.0.1:4104"
)
start_fixture_processes "${PUBLIC_URLS[@]}"
wait_for_fixture_processes
verify_and_export_fixtures
wait_for_shutdown

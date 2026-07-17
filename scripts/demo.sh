#!/usr/bin/env sh
set -eu

node scripts/validate-demo-env.mjs
docker compose up -d --build postgres backend frontend
printf 'LaunchProof is starting at %s/rehearse on X Layer testnet (eip155:1952).\n' "${PUBLIC_WEB_BASE_URL:-http://localhost:3000}"
printf 'Approve only the displayed test USD₮0 x402 terms in your testnet wallet.\n'
printf 'After completion, run: ./scripts/verify-run.sh RUN_ID\n'

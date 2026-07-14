#!/usr/bin/env sh
set -eu

node scripts/validate-demo-env.mjs
docker compose up -d --build postgres backend frontend
printf 'LaunchProof is starting at http://localhost:3000/rehearse\n'
printf 'Approve the real x402 payment in your wallet; no private value was printed.\n'
printf 'After completion, run: ./scripts/verify-run.sh RUN_ID\n'

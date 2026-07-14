$ErrorActionPreference = 'Stop'
node scripts/validate-demo-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Production demo configuration validation failed' }
docker compose up -d --build postgres backend frontend
Write-Output 'LaunchProof is starting at http://localhost:3000/rehearse'
Write-Output 'Approve the real x402 payment in your wallet; no private value was printed.'
Write-Output 'After completion, run: ./scripts/verify-run.sh RUN_ID'

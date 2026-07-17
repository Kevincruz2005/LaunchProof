$ErrorActionPreference = 'Stop'
node scripts/validate-demo-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'X Layer testnet demo configuration validation failed' }
docker compose up -d --build postgres backend frontend
Write-Output 'LaunchProof is starting at http://localhost:3000/rehearse on X Layer testnet (eip155:1952).'
Write-Output 'Approve only the displayed test USD₮0 x402 terms in your testnet wallet.'
Write-Output 'After completion, run: ./scripts/verify-run.sh RUN_ID'

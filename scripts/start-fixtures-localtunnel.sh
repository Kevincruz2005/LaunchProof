#!/usr/bin/env bash
# Starts all 4 fixtures locally and exposes them via localtunnel HTTPS tunnels.
# Auto-fills FIXTURE_* env vars in .env on success.
# Usage: bash scripts/start-fixtures-localtunnel.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if ! command -v node &>/dev/null; then echo "ERROR: node not found"; exit 1; fi

PORTS=(4101 4102 4103 4104)
VARIANTS=(healthy invalid-output schema-drift timeout)
DIRS=(
  "$REPO_ROOT/fixtures/invoice-normalizer-healthy"
  "$REPO_ROOT/fixtures/invoice-normalizer-invalid-output"
  "$REPO_ROOT/fixtures/invoice-normalizer-schema-drift"
  "$REPO_ROOT/fixtures/invoice-normalizer-timeout"
)

# Kill any existing fixture node processes and localtunnels
echo "Cleaning up any old processes..."
pkill -f "[i]nvoice-normalizer" || true
pkill -f "[l]t --port" || true
sleep 1

echo "Starting 4 fixture services..."
PIDS=()
for i in 0 1 2 3; do
  PORT=${PORTS[$i]}
  DIR=${DIRS[$i]}
  VARIANT=${VARIANTS[$i]}
  ALLOW_PRIVATE_TARGETS=true \
  FIXTURE_PROVIDER_PRIVATE_KEY=0x9f6900acc7ded26f6a6636011e249a9080b9aafbf15d489636e1f7dd52863c48 \
  PORT=$PORT \
  SOURCE_REVISION="fixture-${VARIANT}-testnet" \
  node "$DIR/dist/index.js" &>/tmp/fixture-${VARIANT}.log &
  PIDS+=($!)
  echo "  [$VARIANT] started on port $PORT (pid ${PIDS[-1]})"
done

echo "Waiting for fixtures to initialize..."
sleep 3

# Verify all fixtures are up
ALL_UP=true
for i in 0 1 2 3; do
  PORT=${PORTS[$i]}
  VARIANT=${VARIANTS[$i]}
  STATUS=$(curl -s --max-time 3 "http://localhost:$PORT/healthz" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{ try{console.log(JSON.parse(d).status)}catch{console.log('fail')} })" 2>/dev/null || echo "fail")
  if [ "$STATUS" != "ok" ]; then
    echo "  ❌ $VARIANT fixture not responding on port $PORT"
    cat /tmp/fixture-${VARIANT}.log 2>/dev/null | tail -5
    ALL_UP=false
  else
    echo "  ✅ $VARIANT fixture healthy on port $PORT"
  fi
done

if [ "$ALL_UP" != "true" ]; then
  echo "Some fixtures failed to start. Killing all..."
  for PID in "${PIDS[@]}"; do kill "$PID" 2>/dev/null; done
  exit 1
fi

echo ""
echo "Starting localtunnel for all 4 ports..."
npx localtunnel --port 4101 > /tmp/lt-4101.log 2>&1 &
npx localtunnel --port 4102 > /tmp/lt-4102.log 2>&1 &
npx localtunnel --port 4103 > /tmp/lt-4103.log 2>&1 &
npx localtunnel --port 4104 > /tmp/lt-4104.log 2>&1 &

echo "Waiting for tunnels to open..."
sleep 8

# Extract URLs from log files
get_url() {
  cat "/tmp/lt-$1.log" | grep -o 'https://[^ ]*' | head -n 1 || echo ""
}

URL_HEALTHY=$(get_url 4101)
URL_INVALID=$(get_url 4102)
URL_DRIFT=$(get_url 4103)
URL_TIMEOUT=$(get_url 4104)

if [ -z "$URL_HEALTHY" ] || [ -z "$URL_INVALID" ] || [ -z "$URL_DRIFT" ] || [ -z "$URL_TIMEOUT" ]; then
  echo ""
  echo "⚠️  Could not extract all localtunnel URLs."
  echo "    4101: $URL_HEALTHY"
  echo "    4102: $URL_INVALID"
  echo "    4103: $URL_DRIFT"
  echo "    4104: $URL_TIMEOUT"
else
  echo ""
  echo "✅ All tunnels up!"
  echo "  healthy:       $URL_HEALTHY"
  echo "  invalid-output:$URL_INVALID"
  echo "  schema-drift:  $URL_DRIFT"
  echo "  timeout:       $URL_TIMEOUT"

  # Update the config inside the running fixtures with their publicBaseUrl by posting/re-launching?
  # Wait, how do the running fixtures know their publicBaseUrl?
  # The settings inside the running fixtures uses `process.env.PUBLIC_BASE_URL`.
  # Wait, if they are already running, their publicBaseUrl will default to "https://${variant}.fixtures.launchproof.example".
  # BUT we need their signedManifest to return their REAL publicBaseUrl in `mcp_endpoint`, `payment.resource_url`, etc!
  # If PUBLIC_BASE_URL is not set at launch time, their signedManifest will have the example domain, which will fail!
  # So we MUST start the fixtures AFTER we know their public URLs, or restart them with the correct PUBLIC_BASE_URL!
  # Yes! We can start the tunnels first (they don't need the server running to open), then launch the node apps with PUBLIC_BASE_URL set!
  # Let's verify: can localtunnel start tunneling a port before the server is listening?
  # Yes! localtunnel just forwards requests to localhost:port. If the port is not listening yet, it just returns connection refused.
  # So we can:
  # 1. Start all 4 localtunnels
  # 2. Extract their URLs
  # 3. Start all 4 node services WITH the correct PUBLIC_BASE_URL set!
  
  echo "Restarting fixture services with their correct PUBLIC_BASE_URLs..."
  for PID in "${PIDS[@]}"; do kill "$PID" 2>/dev/null || true; done
  sleep 1
  
  PIDS=()
  URLS=("$URL_HEALTHY" "$URL_INVALID" "$URL_DRIFT" "$URL_TIMEOUT")
  for i in 0 1 2 3; do
    PORT=${PORTS[$i]}
    DIR=${DIRS[$i]}
    VARIANT=${VARIANTS[$i]}
    PUBLIC_URL=${URLS[$i]}
    ALLOW_PRIVATE_TARGETS=true \
    FIXTURE_PROVIDER_PRIVATE_KEY=0x9f6900acc7ded26f6a6636011e249a9080b9aafbf15d489636e1f7dd52863c48 \
    PORT=$PORT \
    PUBLIC_BASE_URL=$PUBLIC_URL \
    SOURCE_REVISION="fixture-${VARIANT}-testnet" \
    node "$DIR/dist/index.js" &>/tmp/fixture-${VARIANT}.log &
    PIDS+=($!)
    echo "  [$VARIANT] restarted with PUBLIC_BASE_URL=$PUBLIC_URL (pid ${PIDS[-1]})"
  done
  
  sleep 2

  # Get provider addresses from fixture health endpoints
  ADDR_HEALTHY=$(curl -s -H "bypass-tunnel-reminder: true" "$URL_HEALTHY/.well-known/launch-contract.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_INVALID=$(curl -s -H "bypass-tunnel-reminder: true" "$URL_INVALID/.well-known/launch-contract.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_DRIFT=$(curl -s -H "bypass-tunnel-reminder: true" "$URL_DRIFT/.well-known/launch-contract.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_TIMEOUT=$(curl -s -H "bypass-tunnel-reminder: true" "$URL_TIMEOUT/.well-known/launch-contract.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)

  echo ""
  echo "Provider addresses:"
  echo "  healthy:       $ADDR_HEALTHY"
  echo "  invalid-output:$ADDR_INVALID"
  echo "  schema-drift:  $ADDR_DRIFT"
  echo "  timeout:       $ADDR_TIMEOUT"

  # Extract base domain from healthy URL
  BASE_DOMAIN=$(echo "$URL_HEALTHY" | sed 's|https://||' | sed 's|/.*||')

  echo ""
  echo "Updating .env..."
  node -e "
    const fs = require('fs');
    let env = fs.readFileSync('$ENV_FILE', 'utf8');
    const set = (key, val) => {
      const re = new RegExp('^' + key + '=.*', 'm');
      env = re.test(env) ? env.replace(re, key + '=' + val) : env + '\n' + key + '=' + val;
    };
    set('FIXTURE_BASE_DOMAIN', '$BASE_DOMAIN');
    set('FIXTURE_HEALTHY_PROVIDER_ADDRESS', '$ADDR_HEALTHY');
    set('FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS', '$ADDR_INVALID');
    set('FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS', '$ADDR_DRIFT');
    set('FIXTURE_TIMEOUT_PROVIDER_ADDRESS', '$ADDR_TIMEOUT');
    set('TARGET_ALLOWLIST', '$BASE_DOMAIN');
    fs.writeFileSync('$ENV_FILE', env);
    console.log('✅ .env updated!');
  "

  # Update frontend env variables as well if they are in the file
  node -e "
    const fs = require('fs');
    let env = fs.readFileSync('$ENV_FILE', 'utf8');
    const set = (key, val) => {
      const re = new RegExp('^' + key + '=.*', 'm');
      env = re.test(env) ? env.replace(re, key + '=' + val) : env + '\n' + key + '=' + val;
    };
    // If the frontend needs any public domains, update them here
    fs.writeFileSync('$ENV_FILE', env);
  "

  echo ""
  echo "============================================"
  echo "🎉 Fixtures ready! Now start the app:"
  echo "   pnpm dev"
  echo ""
  echo "   Then visit http://localhost:3000/fixtures"
  echo "   and run a rehearsal to publish to testnet."
  echo "============================================"
fi

echo ""
echo "Fixtures running. Press Ctrl+C to stop everything."
wait

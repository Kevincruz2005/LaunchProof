#!/usr/bin/env bash
# Starts all 4 fixtures locally and exposes them via ngrok HTTPS tunnels.
# Auto-fills FIXTURE_* env vars in .env on success.
# Usage: bash scripts/start-fixtures-ngrok.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGROK="$(which ngrok 2>/dev/null || echo /home/rohan/.config/.foundry/bin/ngrok)"
ENV_FILE="$REPO_ROOT/.env"

if ! command -v node &>/dev/null; then echo "ERROR: node not found"; exit 1; fi
if ! "$NGROK" version &>/dev/null; then echo "ERROR: ngrok not found at $NGROK"; exit 1; fi

# Check ngrok auth
if ! "$NGROK" config check &>/dev/null; then
  echo ""
  echo "❌  ngrok is not authenticated."
  echo "    1. Sign up free at https://ngrok.com"
  echo "    2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "    3. Run: ngrok config add-authtoken <YOUR_TOKEN>"
  echo "    Then re-run this script."
  echo ""
  exit 1
fi

PORTS=(4101 4102 4103 4104)
VARIANTS=(healthy invalid-output schema-drift timeout)
DIRS=(
  "$REPO_ROOT/fixtures/invoice-normalizer-healthy"
  "$REPO_ROOT/fixtures/invoice-normalizer-invalid-output"
  "$REPO_ROOT/fixtures/invoice-normalizer-schema-drift"
  "$REPO_ROOT/fixtures/invoice-normalizer-timeout"
)

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
echo "Starting ngrok tunnels for all 4 ports..."
"$NGROK" http --log=stdout \
  "4101" --url="" &>/tmp/ngrok-healthy.log &
NGROK_PID=$!

# Use ngrok API to open 4 tunnels in parallel
"$NGROK" http 4101 --log /tmp/ngrok-4101.log &
"$NGROK" http 4102 --log /tmp/ngrok-4102.log &
"$NGROK" http 4103 --log /tmp/ngrok-4103.log &
"$NGROK" http 4104 --log /tmp/ngrok-4104.log &

echo "Waiting for tunnels to open..."
sleep 5

# Extract URLs from ngrok local API
get_url() {
  curl -s http://localhost:4040/api/tunnels 2>/dev/null | \
    node -e "
      let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
        try {
          const t = JSON.parse(d).tunnels;
          const port = process.argv[1];
          const match = t.find(x => x.config && x.config.addr && x.config.addr.includes(port) && x.proto === 'https');
          console.log(match ? match.public_url : '');
        } catch { console.log(''); }
      });
    " "$1" 2>/dev/null
}

URL_HEALTHY=$(get_url 4101)
URL_INVALID=$(get_url 4102)
URL_DRIFT=$(get_url 4103)
URL_TIMEOUT=$(get_url 4104)

if [ -z "$URL_HEALTHY" ] || [ -z "$URL_INVALID" ] || [ -z "$URL_DRIFT" ] || [ -z "$URL_TIMEOUT" ]; then
  echo ""
  echo "⚠️  Could not auto-detect all ngrok URLs. Check http://localhost:4040 in browser."
  echo "    URLs found:"
  curl -s http://localhost:4040/api/tunnels | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{JSON.parse(d).tunnels.forEach(t=>console.log(' ',t.proto,t.public_url,t.config.addr))}catch{}})" 2>/dev/null
else
  echo ""
  echo "✅ All tunnels up!"
  echo "  healthy:       $URL_HEALTHY"
  echo "  invalid-output:$URL_INVALID"
  echo "  schema-drift:  $URL_DRIFT"
  echo "  timeout:       $URL_TIMEOUT"

  # Get provider addresses from fixture health endpoints
  ADDR_HEALTHY=$(curl -s http://localhost:4101/.well-known/launch-contract.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_INVALID=$(curl -s http://localhost:4102/.well-known/launch-contract.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_DRIFT=$(curl -s http://localhost:4103/.well-known/launch-contract.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)
  ADDR_TIMEOUT=$(curl -s http://localhost:4104/.well-known/launch-contract.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider_address)}catch{console.log('')}})" 2>/dev/null)

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
  # Use node for reliable in-place env editing
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

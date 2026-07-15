# LaunchProof — Full Setup Guide

LaunchProof is an on-chain agent rehearsal platform built for the OKX x402 hackathon. It verifies an MCP-compatible AI agent service against a strict assertion suite and publishes a cryptographic "Passport" — a permanently-anchored, independently-verifiable proof of operational correctness — to the X Layer blockchain.

---

## Table of Contents
1. [System Requirements](#1-system-requirements)
2. [Clone the Repository](#2-clone-the-repository)
3. [Wallet & Key Setup](#3-wallet--key-setup)
4. [Environment Configuration](#4-environment-configuration)
5. [Database Setup](#5-database-setup)
6. [Install Dependencies & Build Fixtures](#6-install-dependencies--build-fixtures)
7. [Run the Application](#7-run-the-application)
8. [Start the Local Test Fixtures](#8-start-the-local-test-fixtures)
9. [Execute an On-Chain Rehearsal](#9-execute-an-on-chain-rehearsal)
10. [Verifying the On-Chain Result](#10-verifying-the-on-chain-result)
11. [Exposing Fixtures via HTTPS (Optional)](#11-exposing-fixtures-via-https-optional)
12. [Mainnet Deployment (Production)](#12-mainnet-deployment-production)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. System Requirements

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | v18 or v20 LTS | Required. [Download](https://nodejs.org) |
| **pnpm** | v8+ | Install with `npm install -g pnpm` |
| **PostgreSQL** | v14+ | Must be running on port 5432. [Download](https://www.postgresql.org/download/) |
| **Git** | any | For cloning the repository |
| **curl** | any | Used by helper scripts |

> **Quick PostgreSQL check:** Run `psql --version`. If PostgreSQL is not installed, use Docker:
> ```bash
> docker run -d --name launchproof-pg \
>   -e POSTGRES_USER=launchproof \
>   -e POSTGRES_PASSWORD=launchproof \
>   -e POSTGRES_DB=launchproof \
>   -p 5432:5432 postgres:17-alpine
> ```

---

## 2. Clone the Repository

```bash
git clone https://github.com/Kevincruz2005/LaunchProof.git
cd LaunchProof
```

---

## 3. Wallet & Key Setup

LaunchProof needs **two Ethereum-compatible private keys** to operate. These wallets will be used to sign transactions on the X Layer Testnet. They must have testnet OKB to pay gas fees.

### 3a. Generate two fresh wallets

You can use any method. Using `cast` from Foundry is the simplest:

```bash
# Install cast (if not already installed)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Generate wallet 1 — Registry Writer (publishes Passports on-chain)
cast wallet new

# Generate wallet 2 — Target Payer (used internally as a test payer)
cast wallet new
```

Each command prints an **Address** and a **Private Key**. Save both pairs securely.

### 3b. Fund both wallets with Testnet OKB

1. Go to the [X Layer Testnet Faucet](https://www.okx.com/xlayer/faucet).
2. Paste each wallet address and request testnet OKB (for gas).
3. Verify the balance: `cast balance <YOUR_ADDRESS> --rpc-url https://testrpc.xlayer.tech`

> A small amount (0.01 OKB) in each wallet is enough for dozens of rehearsal transactions.

---

## 4. Environment Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` in your editor and configure every section below.

### Section 1 — Service Identity
```env
NODE_ENV=development
PUBLIC_API_BASE_URL=http://localhost:4000
PUBLIC_WEB_BASE_URL=http://localhost:3000
BUILD_COMMIT_SHA=development
SOURCE_REPOSITORY=https://github.com/Kevincruz2005/LaunchProof
OKX_AI_LISTING_URL=
DEMO_VIDEO_URL=
REFERENCE_PAYMENT_ID=
```

### Section 2 — X Layer Testnet (Chain ID 1952)
```env
XLAYER_TESTNET=true
XLAYER_RPC_URL=https://testrpc.xlayer.tech
XLAYER_FALLBACK_RPC_URL=https://xlayertestrpc.okx.com
REGISTRY_ADDRESS=0x222c757aE27e84480588DECB57929AC8be0f4bC4
REGISTRY_DEPLOYMENT_BLOCK=35663616

# Paste private keys (with 0x prefix) from Step 3a
REGISTRY_WRITER_PRIVATE_KEY=0xYOUR_REGISTRY_WRITER_PRIVATE_KEY
TARGET_PAYER_PRIVATE_KEY=0xYOUR_TARGET_PAYER_PRIVATE_KEY
PAYOUT_ADDRESS=0xYOUR_REGISTRY_WRITER_ADDRESS
```

### Section 3 — OKX x402 Facilitator
These are only needed for real Mainnet payment flows. For Testnet local testing, set `X402_ENABLED=false` and leave the keys filled in for reference.
```env
OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_PASSPHRASE=your_okx_passphrase
OKX_BASE_URL=https://www.okx.com
X402_ENABLED=false
```

> **Important:** The `USDT0` payment token only exists on X Layer Mainnet. Setting `X402_ENABLED=true` on Testnet will crash the backend because it cannot find the token contract. Keep it `false` for all Testnet usage.

### Section 4 — Database
```env
DATABASE_URL=postgresql://launchproof:launchproof@localhost:5432/launchproof
```

### Section 5 — Safety Limits (keep defaults for development)
```env
TARGET_PAYMENT_MAX_USDT0=0.10
TARGET_PAYMENT_DAILY_LIMIT_USDT0=1.00
TARGET_ALLOWLIST=
MAX_CONCURRENT_RUNS=3
FREE_RATE_LIMIT_PER_MINUTE=60
PAID_RATE_LIMIT_PER_HOUR=6
GLOBAL_RUN_LIMIT_PER_DAY=100
FIXTURE_BASE_DOMAIN=
FIXTURE_HEALTHY_PROVIDER_ADDRESS=
FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS=
FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS=
FIXTURE_TIMEOUT_PROVIDER_ADDRESS=
```

### Section 6 — Development Flags
```env
# Required: allows the form to submit without a wallet payment
ALLOW_LOCAL_UNPAID_RUNS=true
# Required: allows the backend to reach localhost fixture URLs
ALLOW_PRIVATE_TARGETS=true
```

### Section 7 — Frontend Public Variables
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_XLAYER_RPC_URL=https://testrpc.xlayer.tech
NEXT_PUBLIC_REGISTRY_ADDRESS=0x222c757aE27e84480588DECB57929AC8be0f4bC4
NEXT_PUBLIC_CHAIN_ID=1952
NEXT_PUBLIC_WEB_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SOURCE_REPOSITORY=https://github.com/Kevincruz2005/LaunchProof
NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK=35663616
```

> **Next.js note:** The frontend reads `.env` from its own directory at build time. A symlink is required. Run this once from the project root:
> ```bash
> ln -sf "$(pwd)/.env" frontend/.env
> ```

---

## 5. Database Setup

LaunchProof uses Prisma to manage the PostgreSQL schema. Run these commands once from the project root:

```bash
# Ensure the launchproof database exists
psql -U postgres -c "CREATE USER launchproof WITH PASSWORD 'launchproof';" || true
psql -U postgres -c "CREATE DATABASE launchproof OWNER launchproof;" || true

# Apply the full schema
cd backend
npx prisma db push
cd ..
```

You should see `Your database is now in sync with your Prisma schema` at the end.

---

## 6. Install Dependencies & Build Fixtures

From the project root, install all workspace dependencies and compile the fixture services:

```bash
# Install all packages for all workspaces
pnpm install

# Build the 4 test fixture services (required before running them)
pnpm --filter "@launchproof/fixture-*" build
```

This compiles the four fixtures in `fixtures/` into `dist/index.js` files that the startup scripts can run.

---

## 7. Run the Application

Start the frontend (Next.js) and backend (Express) simultaneously:

```bash
pnpm dev
```

This runs both services in parallel:
- **Frontend:** `http://localhost:3000`
- **Backend API:** `http://localhost:4000`

Wait until you see `✓ Ready in Xms` in the terminal output before proceeding.

---

## 8. Start the Local Test Fixtures

In a **new terminal window**, start all four fixture services. Each one simulates a different type of MCP agent behavior.

```bash
bash scripts/start-fixtures-localtunnel.sh
```

This script:
1. Starts 4 fixture services on ports `4101`, `4102`, `4103`, `4104`.
2. Opens HTTPS tunnels via `localtunnel` so the backend can reach them.
3. Automatically updates `FIXTURE_*` variables in your `.env` file.
4. Keeps running until you press `Ctrl+C`.

**If you prefer local-only without HTTPS tunnels:**
```bash
# Terminal 2 — Start only the healthy fixture
cd fixtures/invoice-normalizer-healthy
ALLOW_PRIVATE_TARGETS=true \
FIXTURE_PROVIDER_PRIVATE_KEY=0xYOUR_TARGET_PAYER_PRIVATE_KEY \
PORT=4101 \
SOURCE_REVISION=fixture-healthy-testnet \
node dist/index.js
```
Then use `http://127.0.0.1:4101` as your service URL in the UI.

**Verify the fixture is alive:**
```bash
curl http://127.0.0.1:4101/healthz
# Expected: {"status":"ok"}
```

---

## 9. Execute an On-Chain Rehearsal

1. Open your browser at `http://localhost:3000`
2. You will see the **LaunchProof** dashboard.
3. In the URL input box, paste your fixture address:
   - **Local:** `http://127.0.0.1:4101`
   - **With tunnel:** The `https://...loca.lt` URL printed by the script.
4. Click **"Rehearse and Publish on X Layer"**.

The dashboard will progress through these stages in real time:

| Stage | What happens |
|-------|-------------|
| **Contract fetched** | Backend fetches the agent's `launch-contract.json` and validates its cryptographic signature. |
| **Tool discovered** | Backend calls the agent's MCP `tools/list` endpoint to find the callable tool. |
| **Fixed sample** | Runs the agent with a known invoice and checks all output fields match. |
| **Controlled invalid input** | Sends invalid input and verifies the agent returns a structured error, not a crash. |
| **Fresh challenge 1–3** | Runs three randomly-generated invoices with no pre-known answers to test genuine intelligence. |
| **Evidence anchored** | All hashes are computed, signed, and published to the X Layer Testnet smart contract via `REGISTRY_WRITER_PRIVATE_KEY`. |

When complete, the browser navigates to the **Service Passport** page showing all hashes and a live link to the blockchain transaction.

---

## 10. Verifying the On-Chain Result

On the Passport page, you will see:

- **Run ID** — The unique hash identifying this run.
- **Evidence hash** — SHA-256 of the canonical JSON evidence blob.
- **Manifest hash** — Hash of the agent's signed manifest.
- **Input hash** — Hash of the full input sent to the agent.
- **Evidence transaction** — A direct link to the X Layer Testnet block explorer showing the on-chain record.

Click **"Evidence transaction ↗"** to open the transaction on the block explorer and independently verify the hash is anchored on-chain.

---

## 11. Exposing Fixtures via HTTPS (Optional)

The backend's `safe-fetch` module blocks plain `http://` URLs in production for security. To run rehearsals against a realistic HTTPS endpoint, use one of the provided tunnel scripts.

### Option A — LocalTunnel (no account required)
```bash
bash scripts/start-fixtures-localtunnel.sh
```

### Option B — ngrok (requires free account)
1. [Create a free ngrok account](https://dashboard.ngrok.com) and get your auth token.
2. Run `ngrok config add-authtoken YOUR_TOKEN`.
3. Run the ngrok script:
   ```bash
   bash scripts/start-fixtures-ngrok.sh
   ```

Both scripts auto-update your `.env` with the live HTTPS fixture URLs and provider addresses.

---

## 12. Mainnet Deployment (Production)

To run LaunchProof on the X Layer Mainnet with real USDT0 payments, you must:

1. **Change chain ID** in `.env`:
   ```env
   XLAYER_TESTNET=false
   XLAYER_RPC_URL=https://rpc.xlayer.tech
   XLAYER_FALLBACK_RPC_URL=https://xlayerrpc.okx.com
   NEXT_PUBLIC_CHAIN_ID=196
   ```

2. **Enable OKX x402 payments:**
   ```env
   X402_ENABLED=true
   OKX_API_KEY=your_real_api_key
   OKX_SECRET_KEY=your_real_secret
   OKX_PASSPHRASE=your_real_passphrase
   ```
   > Get your API Key + Passphrase from the [OKX Developer Dashboard](https://www.okx.com/account/my-api). Only "Read" permission is required.

3. **Set production URLs:**
   ```env
   NODE_ENV=production
   PUBLIC_API_BASE_URL=https://api.yourdomain.com
   PUBLIC_WEB_BASE_URL=https://yourdomain.com
   NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
   NEXT_PUBLIC_WEB_BASE_URL=https://yourdomain.com
   ```

4. **Fund your Mainnet wallets** with real OKB for gas and ensure the payer wallet has USDT0.

5. **Remove dev flags:**
   ```env
   ALLOW_LOCAL_UNPAID_RUNS=false
   ALLOW_PRIVATE_TARGETS=false
   ```

---

## 13. Troubleshooting

### `Production RPC returned chain X; expected Y`
Your `XLAYER_RPC_URL` is pointing to a different chain than `NEXT_PUBLIC_CHAIN_ID`. Make sure both are consistently set to `1952` (testnet) or `196` (mainnet).

### `The contract function "decimals" returned no data`
You have `X402_ENABLED=true` on the Testnet. The USDT0 token only exists on Mainnet. Set `X402_ENABLED=false`.

### `ALLOW_PRIVATE_TARGETS` error
Your backend is blocking `localhost` or `127.0.0.1` URLs. Add `ALLOW_PRIVATE_TARGETS=true` to your `.env`.

### Backend crashes on startup / `401 Unauthorized`
Your OKX API Passphrase is incorrect or missing. Either set `X402_ENABLED=false`, or go to the OKX Developer Dashboard to regenerate your key with the correct passphrase.

### Fixture fails health check
Make sure you ran `pnpm --filter "@launchproof/fixture-*" build` first. The startup scripts run pre-compiled `dist/index.js` files.

### Database connection refused
Ensure PostgreSQL is running: `pg_isready -U launchproof`. If using Docker, check `docker ps` to confirm the container is up.

---

*LaunchProof · On-chain-settled. Off-chain rehearsed. Independently verifiable.*

# LaunchProof Setup Guide

Welcome to LaunchProof! This guide will walk you through setting up the application locally, connecting it to the X Layer Testnet, and running your first on-chain agent rehearsal.

## Prerequisites
Before you begin, ensure you have the following installed:
* **Node.js** (v18+)
* **pnpm** (Package manager)
* **PostgreSQL** (Running locally on default port 5432)

## 1. Environment Setup
At the root of the project, create a `.env` file (or copy the provided `.env.example`). You must configure the following key variables for **Testnet** execution:

```env
# Blockchain Configuration (X Layer Testnet)
NEXT_PUBLIC_CHAIN_ID=1952
XLAYER_RPC_URL=https://testrpc.xlayer.tech
REGISTRY_ADDRESS=0x222c757aE27e84480588DECB57929AC8be0f4bC4

# Wallets (Provide valid private keys funded with Testnet OKB)
REGISTRY_WRITER_PRIVATE_KEY=your_private_key_here
TARGET_PAYER_PRIVATE_KEY=your_private_key_here
PAYOUT_ADDRESS=your_wallet_address_here

# Payment Verification (Set to FALSE for Testnet/Local testing)
X402_ENABLED=false

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/launchproof
```
> **Note on OKX API Keys:** Because the real `USDT0` token contract only exists on the X Layer Mainnet, the `x402` payment validation will crash on the testnet. Keep `X402_ENABLED=false` unless you are deploying to the live Mainnet with real OKX Facilitator credentials.

## 2. Database Initialization
LaunchProof uses Prisma and PostgreSQL to store runs and agent configurations.
Run the following commands from the root directory to initialize the database:
```bash
pnpm install
cd backend
npx prisma db push
cd ..
```

## 3. Start the Application
Start both the Next.js frontend and the Express backend simultaneously using the workspace command:
```bash
pnpm dev
```
* **Frontend:** `http://localhost:3000`
* **Backend:** `http://localhost:4000`

## 4. Run a Test Fixture
To test the LaunchProof verification system, you need an active MCP (Model Context Protocol) agent or "fixture" to rehearse against.

Open a new terminal window and start the provided local test fixture:
```bash
cd fixtures/node-healthy
pnpm dev
```
This fixture will run on `http://127.0.0.1:4101`.

## 5. Execute an On-Chain Rehearsal
1. Open your browser and navigate to `http://localhost:3000`.
2. In the URL input box, paste your fixture's address: `http://127.0.0.1:4101`.
3. Click the **Rehearse and Publish on X Layer** button.
4. Watch the dashboard as LaunchProof securely executes the MCP agent, validates the assertions, hashes the evidence, and publishes a permanent cryptographic Passport to the X Layer Testnet!

---
*Built for the OKX x402 Hackathon.*

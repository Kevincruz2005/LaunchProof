# LaunchProof — X Layer Testnet Setup

This guide produces a fully testnet run with two real OKX x402 settlements, a real registry transaction, source-derived hashes, four provider-signed fixtures, and read-only verification against X Layer testnet. It does not use a mock chain, a fabricated transaction hash, or a shared fixture identity.

The supported profile is:

| Setting | Value |
|---|---|
| Chain | X Layer testnet |
| Chain ID | `1952` |
| CAIP-2 network | `eip155:1952` |
| RPC | `https://testrpc.xlayer.tech/terigon` |
| Fallback RPC | `https://xlayertestrpc.okx.com/terigon` |
| Explorer | `https://www.okx.com/web3/explorer/xlayer-test` |
| Test USD₮0 | `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` (6 decimals) |
| OKX facilitator | `https://web3.okx.com` |

These public values follow the official [X Layer network documentation](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information), [RPC documentation](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints), and [OKX x402 seller guide](https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk).

## 0. Rotate previously exposed credentials

Do not use any private key, OKX API credential, passphrase, or tunnel token that has appeared in chat, Git history, terminal output, screenshots, or recordings. Treat all such values as compromised.

The former registry writer key was exposed. Because the registry writer is immutable—and the updated contract also enforces paid/five-gate and signed-fixture invariants—a safe setup requires a new writer key and a newly deployed registry from the current source. Revoking the old OKX credentials and removing committed secrets from Git history are separate operational steps; editing the latest file alone does not erase Git history.

Registry `0x222c757aE27e84480588DECB57929AC8be0f4bC4` is explicitly deprecated for this release. Do not configure, publish to, or trust it; its historical chain data is left untouched.

## 1. Prerequisites

| Tool | Supported version | Purpose |
|---|---|---|
| Node.js | `20.18.1` through Node `24`; Node 24 recommended | Application and scripts |
| pnpm | exactly `10.13.1` | Locked workspace install |
| Docker Compose or PostgreSQL | PostgreSQL 17 used by Compose | Index/cache |
| Foundry | current `forge` and `cast` | Contract test/deployment |
| Git, curl, jq | current | Source and verification helpers |

Install Foundry from its official instructions if `forge --version` is unavailable. Never pipe an installer into a privileged shell without reviewing it.

Enable the pinned package manager:

```bash
corepack enable
corepack prepare pnpm@10.13.1 --activate
node --version
pnpm --version
```

## 2. Clone and install before running Prisma

```bash
git clone https://github.com/Kevincruz2005/LaunchProof.git
cd LaunchProof
pnpm install --frozen-lockfile
pnpm --filter @launchproof/backend exec prisma generate
pnpm fixtures:build
pnpm contract:build
```

`pnpm contract:build` compiles the registry, validates the deploy script, and refreshes the checked ABI. Run the complete local checks before deployment:

```bash
pnpm check
(
  cd contracts
  forge fmt --check
  forge test -vvv
)
```

Do not deploy a dirty or failing checkout. Commit the exact source that will be run so its immutable SHA can be placed in every fixture manifest and evidence record.

## 3. Create the ignored environment and fresh wallets

```bash
cp .env.example .env
chmod 600 .env
pnpm keys:testnet
node scripts/update-env.mjs .env BUILD_COMMIT_SHA "$(git rev-parse HEAD)"
```

`pnpm keys:testnet` creates unique registry-writer, target-payer, payout, healthy-fixture, invalid-output-fixture, schema-drift-fixture, timeout-fixture, and deployer keys. It writes only runtime application/fixture keys to ignored `.env`. Deployer custody stays in `.env.deployer.local`; payout custody stays in `.env.payout.local` and is never loaded by the application or fixtures. It mirrors the public payout address into `NEXT_PUBLIC_PAYOUT_ADDRESS` so the browser can fail closed on a mismatched x402 recipient. All files are mode `0600`, and only public addresses are printed.

Back up `.env.payout.local` in an encrypted offline secret store before accepting test-token payments. Losing it loses access to anything sent to `PAYOUT_ADDRESS`; do not copy its key into the application environment. Test tokens have no monetary value, but the same role separation must be preserved for safe operating practice.

If `.env` already contained any old or disclosed key, rotate every generated role deliberately:

```bash
pnpm keys:testnet -- --force
node scripts/update-env.mjs .env BUILD_COMMIT_SHA "$(git rev-parse HEAD)"
```

`--force` also clears the old registry address, deployment block, runtime bytecode hash, and matching browser values. A rotated immutable writer must always be followed by a fresh deployment; the validator will reject incomplete or stale registry metadata.

Never commit either file. `.gitignore` excludes `.env*` except `.env.example`, common private-key formats, and secret directories.

Open `.env` and confirm the public profile remains consistent:

```env
XLAYER_TESTNET=true
ALLOW_XLAYER_MAINNET=false
XLAYER_CHAIN_ID=1952
XLAYER_NETWORK=eip155:1952
XLAYER_USDT0_ADDRESS=0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c
XLAYER_RPC_URL=https://testrpc.xlayer.tech/terigon
XLAYER_FALLBACK_RPC_URL=https://xlayertestrpc.okx.com/terigon
NEXT_PUBLIC_CHAIN_ID=1952
```

Mainnet is outside this setup and the backend refuses it. Leave `ALLOW_XLAYER_MAINNET=false`.

## 4. Fund only testnet wallets and tokens

Use the official X Layer faucet and current OKX x402 buyer documentation. Testnet assets have no monetary value.

Fund these public addresses with test OKB for gas:

- `DEPLOYER_ADDRESS` printed by the key generator, for one deployment.
- `REGISTRY_WRITER_ADDRESS`, for evidence publications.
- `TARGET_PAYER_ADDRESS`, for paid target delivery if required by the settlement path.
- The browser test wallet used to approve the LaunchProof x402 charge.

Fund these with official test USD₮0:

- `TARGET_PAYER_ADDRESS`, for the healthy fixture's paid resource.
- The browser test wallet, for the Genesis or renewal charge.

Before deployment, copy the generated public deployer address (never its key) and confirm the faucet transfer is visible on chain:

```bash
DEPLOYER='paste the generated DEPLOYER_ADDRESS'
cast balance "$DEPLOYER" --rpc-url https://testrpc.xlayer.tech/terigon --ether
```

The result must be greater than zero test OKB. `pnpm registry:deploy-testnet` independently checks the RPC chain and this live balance immediately before invoking Forge, and refuses to broadcast otherwise. Later, `node scripts/validate-demo-env.mjs` requires nonzero test OKB for both `REGISTRY_WRITER_ADDRESS` and `TARGET_PAYER_ADDRESS`, plus a target-payer test USD₮0 balance at least as large as the greater of the healthy fixture amount and `TARGET_PAYMENT_MAX_USDT0`.

Do not send real tokens to testnet addresses. Before continuing, check that the token shown by the faucet or wallet is the configured testnet address, not a similarly named token. Keep `TARGET_PAYMENT_DAILY_LIMIT_USDT0 >= TARGET_PAYMENT_MAX_USDT0 >= FIXTURE_PAYMENT_AMOUNT_ATOMIC / 1_000_000`; the validator rejects a configuration that would deterministically block the controlled paid delivery.

## 5. Deploy a fresh registry to chain 1952

The deploy script requires the expected chain ID and public writer address before it will broadcast. The Node wrapper parses environment files as data and gives Forge only the RPC, chain ID, writer, and deployer key; OKX, payer, fixture, and payout credentials are never sourced or inherited by Forge:

```bash
forge build --root contracts
pnpm registry:deploy-testnet
```

Extract the registry deployment transaction from Foundry's ignored broadcast artifact:

```bash
DEPLOY_TX="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .hash' \
  contracts/broadcast/Deploy.s.sol/1952/run-latest.json | tail -n 1)"
test -n "$DEPLOY_TX"
pnpm registry:record-testnet -- "$DEPLOY_TX"
```

The recording helper is read-only. It requires:

- RPC chain ID `1952`;
- a successful contract-creation receipt;
- transaction sender equal to the generated `DEPLOYER_ADDRESS`;
- CREATE input exactly equal to the locally built Foundry `LaunchProofRegistry` creation bytecode plus the expected writer constructor argument;
- Foundry artifact source hash equal to the clean committed registry source;
- no bytecode at that address in the block before deployment;
- live bytecode at the deployed address;
- `writer()` equal to `REGISTRY_WRITER_ADDRESS`;
- `MAX_EVIDENCE_BYTES()` equal to `65536`.

It computes `keccak256(eth_getCode)`, then writes the observed `REGISTRY_ADDRESS`, `REGISTRY_DEPLOYMENT_BLOCK`, `REGISTRY_RUNTIME_CODE_HASH`, and matching `NEXT_PUBLIC_*` values to ignored `.env`. No address, block, or runtime hash is copied from documentation or guessed.

## 6. Configure fresh OKX x402 credentials

Create new test-capable OKX API credentials following the official seller guide. Put them only in ignored `.env`:

```env
OKX_API_KEY=REDACTED_NEW_VALUE
OKX_SECRET_KEY=REDACTED_NEW_VALUE
OKX_PASSPHRASE=REDACTED_NEW_VALUE
OKX_BASE_URL=https://web3.okx.com
X402_ENABLED=true
FIXTURE_X402_ENABLED=true
```

The key generator sets `FIXTURE_PAYMENT_RECIPIENT` to the separately controlled `PAYOUT_ADDRESS`. The example config sets `FIXTURE_PAYMENT_AMOUNT_ATOMIC=10000` (`0.01` at six decimals); this amount is configurable, signed into the manifest, verified exactly, and must remain within both target-payment caps.

The application and fixture both pass the configured CAIP-2 network and asset into the SDK. They do not select mainnet from a frontend variable or accept arbitrary wallet payment terms.

## 7. Start PostgreSQL and apply migrations

Compose publishes PostgreSQL only on loopback:

```bash
docker compose up -d postgres
node --env-file=.env backend/node_modules/prisma/build/index.js migrate deploy \
  --schema backend/prisma/schema.prisma
```

Alternatively, point `DATABASE_URL` at an existing PostgreSQL 14+ instance and run the same migration command. Do not use `prisma db push` for the reproducible demo; committed migrations include payment settlement uniqueness and explicit amount units.

## 8. Start four explicit fixtures

For a real public rehearsal, use four HTTPS tunnel endpoints. Ngrok is preferred because the script validates the same URL without a provider-specific bypass header:

```bash
# Put a fresh token in ignored .env as NGROK_AUTHTOKEN, then:
bash scripts/start-fixtures-ngrok.sh
```

The script starts one ngrok agent with four named endpoints, then starts the services only after their public URLs are known. It:

1. Refuses a dirty Git worktree.
2. Uses the committed `git rev-parse HEAD` as every fixture's `SOURCE_REVISION`.
3. Injects a distinct private key into each fixture process without printing it.
4. Injects `XLAYER_CHAIN_ID`, `XLAYER_NETWORK`, and `XLAYER_USDT0_ADDRESS` from `.env`.
5. Verifies each public signed manifest and its exact MCP/payment URLs.
6. Writes four exact `FIXTURE_*_URL` values and matching public addresses to `.env`.
7. Writes a comma-separated hostname `TARGET_ALLOWLIST`; it never invents variant subdomains.
8. Stops only processes it started when interrupted.

Fixture servers bind to loopback in tunnel and local-script mode. Container images opt in to `0.0.0.0` explicitly so Docker networking works without making the direct host process public by default.

LocalTunnel remains available:

```bash
bash scripts/start-fixtures-localtunnel.sh
```

It uses the pinned workspace package, never an unversioned `npx` download, and fails if a tunnel interstitial prevents the backend-equivalent manifest fetch.

Keep the fixture terminal running. Restart the application after the script updates `.env`.

### Deterministic local-only fixture mode

For integration tests without tunnel DNS:

```bash
node scripts/update-env.mjs .env \
  ALLOW_PRIVATE_TARGETS true \
  ALLOW_LOCAL_UNPAID_RUNS true \
  X402_ENABLED false \
  FIXTURE_X402_ENABLED false
pnpm fixtures:local
```

This mode always uses the explicit URLs `http://127.0.0.1:4101` through `:4104`. It may run from a dirty worktree only with a warning. It is development evidence, not a paid verified Passport, and `scripts/verify-run.sh` intentionally rejects it.

Restore both development escape hatches to `false` before a public run.

## 9. Validate the complete testnet configuration

After the public fixture script has populated `.env`:

Set the public runtime mode and exact HTTPS service origins. Public, chain-ready, or x402 startup deliberately refuses development mode:

```bash
node scripts/update-env.mjs .env \
  NODE_ENV production \
  PUBLIC_API_BASE_URL https://YOUR-PERSISTENT-BACKEND \
  PUBLIC_WEB_BASE_URL https://YOUR-VERCEL-FRONTEND \
  NEXT_PUBLIC_API_BASE_URL https://YOUR-PERSISTENT-BACKEND \
  NEXT_PUBLIC_WEB_BASE_URL https://YOUR-VERCEL-FRONTEND
```

```bash
node scripts/validate-demo-env.mjs
```

The validator performs static provenance, mode-0600 custody, role-separation, URL, allowlist, chain, asset, key/address, cap/fixture-amount, and payment-mode checks. It proves the segregated deployer and payout custody keys match their public addresses without printing or loading those keys into the application. It also queries both RPCs, verifies deployment boundaries, registry writer/runtime hash/evidence limit, writer/target-payer gas, target-payer test-token balance, test USD₮0 bytecode/decimals, facilitator exact-scheme support for `eip155:1952`, and every field/signature/identity in all four public fixture manifests. It sends no transaction.

For a static check in an offline CI environment, use `node scripts/validate-demo-env.mjs --offline`. Static validation still requires the exact clean `BUILD_COMMIT_SHA`.

## 10. Start LaunchProof

The reproducible container path is:

```bash
./scripts/demo.sh
```

That command validates the testnet environment, builds the backend/frontend, starts PostgreSQL, applies migrations in the backend container, and exposes:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

For host development after PostgreSQL and fixtures are running:

```bash
pnpm dev
```

The backend loads the root `.env`; the frontend receives only `NEXT_PUBLIC_*` values. Never rename a secret with a `NEXT_PUBLIC_` prefix.

## 11. Execute the real paid testnet run

1. Open `http://localhost:3000/rehearse`.
2. Select the healthy fixture whose exact URL and declaration address came from `/fixtures`.
3. Connect a wallet on X Layer testnet chain `1952`.
4. Inspect the x402 challenge. Confirm network `eip155:1952`, official test USD₮0, the expected atomic/display amount, and configured payout address.
5. Approve the test-token payment.
6. Wait for the fixed sample, invalid-input check, three fresh challenges, paid target delivery, and registry publication.

A fully verified result requires three separate successful testnet transactions or settlement proofs in the run data:

- LaunchProof x402 settlement from the browser wallet.
- Target-delivery x402 settlement from `TARGET_PAYER_ADDRESS`.
- Registry evidence publication from `REGISTRY_WRITER_ADDRESS`.

No run may display `verified` unless all five gates are `pass`; `paid_delivery=not_tested` or any local-only payment status is not verified.

## 12. Verify hashes, payments, and chain publication

```bash
RUN_ID=0xYOUR_32_BYTE_RUN_ID
curl -fsS "http://localhost:4000/runs/$RUN_ID" | jq .
curl -fsS "http://localhost:4000/verify/$RUN_ID" | jq .
./scripts/verify-run.sh "$RUN_ID"
```

The helper requires:

- execution mode `testnet` and network `eip155:1952`;
- provenance label `fixture` or `external` with `execution_mode=testnet`;
- all five gates `pass` and Passport status `verified`;
- settled launch and target payments with transaction hashes;
- a published registry transaction;
- exact canonical-event-bytes/JCS equality plus matching evidence, manifest, input, result, provider-signature, gate, storage, and linkage checks.

The API's PostgreSQL result is a cache. It cannot make registry verification pass.

## Troubleshooting

### RPC reports chain 196, 195, or another value

Use the testnet `/terigon` RPC URLs above. The required chain ID is `1952`; `195` is not the X Layer testnet chain ID.

### Registry runtime hash mismatch

Do not copy a hash from another deployment. Run `pnpm registry:record-testnet -- DEPLOYMENT_TX_HASH` for the actual new registry and restart the backend.

### Writer mismatch

The deployed contract is immutable. If it was created with the wrong or exposed writer, deploy a new registry. Changing `.env` cannot replace the contract's writer.

### Test USD₮0 has no code or wrong decimals

Confirm `XLAYER_TESTNET=true`, chain ID `1952`, and the official test-token address. A mainnet token address has no valid testnet code.

### Fixture source revision mismatch

Commit the exact code, rebuild fixtures, and rerun the public tunnel script. Public scripts deliberately refuse dirty worktrees.

### LocalTunnel returns an HTML reminder or 5xx

The public manifest verifier rejects it because the backend would not receive the signed JSON. Use the ngrok script or another stable HTTPS deployment and enter all four explicit URLs.

### Database migration fails

Check `docker compose ps postgres`, then confirm `DATABASE_URL` points to `localhost:5432` for host commands or `postgres:5432` inside Compose.

### Configuration validator rejects local flags

That is intentional. A paid public testnet proof requires `ALLOW_LOCAL_UNPAID_RUNS=false` and `ALLOW_PRIVATE_TARGETS=false`.

---

LaunchProof testnet evidence is onchain and independently hash-verifiable, but it remains a single-writer attestation—not a security certification, decentralized oracle, mainnet settlement, marketplace identity check, or OKX endorsement.

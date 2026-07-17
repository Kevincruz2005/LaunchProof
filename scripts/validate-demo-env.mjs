import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const TESTNET_CHAIN_ID = 1952;
const TESTNET_NETWORK = "eip155:1952";
const TESTNET_USDT0 = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";
const offline = process.argv.includes("--offline");

const fileValues = {};
if (existsSync(".env")) {
  if ((statSync(".env").mode & 0o077) !== 0) throw new Error(".env contains secrets and must not be readable by group or other users");
  for (const rawLine of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fileValues[name] = value;
  }
}

const values = { ...fileValues, ...process.env };
const required = [
  "XLAYER_CHAIN_ID",
  "ALLOW_XLAYER_MAINNET",
  "XLAYER_NETWORK",
  "XLAYER_USDT0_ADDRESS",
  "XLAYER_EXPLORER_URL",
  "XLAYER_RPC_URL",
  "XLAYER_FALLBACK_RPC_URL",
  "REGISTRY_ADDRESS",
  "REGISTRY_DEPLOYMENT_BLOCK",
  "REGISTRY_RUNTIME_CODE_HASH",
  "REGISTRY_WRITER_ADDRESS",
  "REGISTRY_WRITER_PRIVATE_KEY",
  "TARGET_PAYER_ADDRESS",
  "TARGET_PAYER_PRIVATE_KEY",
  "PAYOUT_ADDRESS",
  "DEPLOYER_ADDRESS",
  "PUBLIC_API_BASE_URL",
  "PUBLIC_WEB_BASE_URL",
  "BUILD_COMMIT_SHA",
  "SOURCE_REPOSITORY",
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
  "OKX_BASE_URL",
  "DATABASE_URL",
  "TARGET_PAYMENT_MAX_USDT0",
  "TARGET_PAYMENT_DAILY_LIMIT_USDT0",
  "FIXTURE_HEALTHY_URL",
  "FIXTURE_INVALID_OUTPUT_URL",
  "FIXTURE_SCHEMA_DRIFT_URL",
  "FIXTURE_TIMEOUT_URL",
  "FIXTURE_HEALTHY_PROVIDER_ADDRESS",
  "FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS",
  "FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS",
  "FIXTURE_TIMEOUT_PROVIDER_ADDRESS",
  "FIXTURE_HEALTHY_PROVIDER_PRIVATE_KEY",
  "FIXTURE_INVALID_OUTPUT_PROVIDER_PRIVATE_KEY",
  "FIXTURE_SCHEMA_DRIFT_PROVIDER_PRIVATE_KEY",
  "FIXTURE_TIMEOUT_PROVIDER_PRIVATE_KEY",
  "FIXTURE_PAYMENT_RECIPIENT",
  "FIXTURE_PAYMENT_AMOUNT_ATOMIC",
  "TARGET_ALLOWLIST",
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_XLAYER_RPC_URL",
  "NEXT_PUBLIC_REGISTRY_ADDRESS",
  "NEXT_PUBLIC_PAYOUT_ADDRESS",
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_WEB_BASE_URL",
  "NEXT_PUBLIC_SOURCE_REPOSITORY",
  "NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK",
];
const missing = required.filter((name) => !values[name]);
if (missing.length) throw new Error(`Missing required testnet values: ${missing.join(", ")}`);
if (values.PAYOUT_PRIVATE_KEY || values.DEPLOYER_PRIVATE_KEY) throw new Error("Payout and deployer private keys must not be loaded from application .env");

if (values.XLAYER_TESTNET !== "true") throw new Error("XLAYER_TESTNET must be true");
if (values.ALLOW_XLAYER_MAINNET !== "false") throw new Error("ALLOW_XLAYER_MAINNET must be false for the testnet-only setup");
if (Number(values.XLAYER_CHAIN_ID) !== TESTNET_CHAIN_ID) throw new Error(`XLAYER_CHAIN_ID must be ${TESTNET_CHAIN_ID}`);
if (values.XLAYER_NETWORK !== TESTNET_NETWORK) throw new Error(`XLAYER_NETWORK must be ${TESTNET_NETWORK}`);
if (values.XLAYER_USDT0_ADDRESS.toLowerCase() !== TESTNET_USDT0) throw new Error("XLAYER_USDT0_ADDRESS is not the official X Layer testnet USD₮0 contract");
if (values.X402_ENABLED !== "true") throw new Error("X402_ENABLED must be true for a real paid testnet rehearsal");
if (values.NODE_ENV !== "production") throw new Error("NODE_ENV must be production for a public paid testnet rehearsal");
if (values.FIXTURE_X402_ENABLED !== "true") throw new Error("FIXTURE_X402_ENABLED must be true to exercise real target delivery payment");
if (values.ALLOW_LOCAL_UNPAID_RUNS === "true") throw new Error("ALLOW_LOCAL_UNPAID_RUNS must be false for paid evidence");
if (values.ALLOW_PRIVATE_TARGETS === "true") throw new Error("ALLOW_PRIVATE_TARGETS must be false for a public fixture rehearsal");
if (!/^https:\/\//.test(values.XLAYER_RPC_URL) || !/^https:\/\//.test(values.XLAYER_FALLBACK_RPC_URL)) throw new Error("Both RPC URLs must use HTTPS");
const okxBaseUrl = new URL(values.OKX_BASE_URL);
if (
  okxBaseUrl.origin !== "https://web3.okx.com" ||
  okxBaseUrl.pathname !== "/" ||
  okxBaseUrl.search ||
  okxBaseUrl.hash ||
  okxBaseUrl.username ||
  okxBaseUrl.password
) throw new Error("OKX_BASE_URL must be the exact official origin https://web3.okx.com");
if (values.XLAYER_EXPLORER_URL !== "https://www.okx.com/web3/explorer/xlayer-test") {
  throw new Error("XLAYER_EXPLORER_URL must be the official X Layer testnet explorer");
}
if (!/^0x[0-9a-fA-F]{40}$/.test(values.REGISTRY_ADDRESS) || /^0x0{40}$/i.test(values.REGISTRY_ADDRESS)) throw new Error("REGISTRY_ADDRESS is invalid");
if (!/^0x[0-9a-fA-F]{64}$/.test(values.REGISTRY_RUNTIME_CODE_HASH)) throw new Error("REGISTRY_RUNTIME_CODE_HASH is invalid");
if (!/^[1-9][0-9]*$/.test(values.REGISTRY_DEPLOYMENT_BLOCK)) throw new Error("REGISTRY_DEPLOYMENT_BLOCK must be a positive block number");
if (!/^[0-9a-f]{40}$/i.test(values.BUILD_COMMIT_SHA)) throw new Error("BUILD_COMMIT_SHA must be an immutable 40-character commit");
if (/your-org|\.example(?:\/|$)/i.test(values.SOURCE_REPOSITORY)) throw new Error("SOURCE_REPOSITORY must be the real repository");
if (values.NODE_ENV === "production" && (!values.PUBLIC_API_BASE_URL.startsWith("https://") || !values.PUBLIC_WEB_BASE_URL.startsWith("https://"))) {
  throw new Error("Production public URLs must use HTTPS");
}
if (values.NEXT_PUBLIC_API_BASE_URL !== values.PUBLIC_API_BASE_URL) throw new Error("NEXT_PUBLIC_API_BASE_URL must match PUBLIC_API_BASE_URL");
if (values.NEXT_PUBLIC_XLAYER_RPC_URL !== values.XLAYER_RPC_URL) throw new Error("NEXT_PUBLIC_XLAYER_RPC_URL must match XLAYER_RPC_URL");
if (values.NEXT_PUBLIC_REGISTRY_ADDRESS.toLowerCase() !== values.REGISTRY_ADDRESS.toLowerCase()) throw new Error("NEXT_PUBLIC_REGISTRY_ADDRESS must match REGISTRY_ADDRESS");
if (values.NEXT_PUBLIC_PAYOUT_ADDRESS.toLowerCase() !== values.PAYOUT_ADDRESS.toLowerCase()) throw new Error("NEXT_PUBLIC_PAYOUT_ADDRESS must match PAYOUT_ADDRESS");
if (values.NEXT_PUBLIC_CHAIN_ID !== values.XLAYER_CHAIN_ID) throw new Error("NEXT_PUBLIC_CHAIN_ID must match XLAYER_CHAIN_ID");
if (values.NEXT_PUBLIC_WEB_BASE_URL !== values.PUBLIC_WEB_BASE_URL) throw new Error("NEXT_PUBLIC_WEB_BASE_URL must match PUBLIC_WEB_BASE_URL");
if (values.NEXT_PUBLIC_SOURCE_REPOSITORY !== values.SOURCE_REPOSITORY) throw new Error("NEXT_PUBLIC_SOURCE_REPOSITORY must match SOURCE_REPOSITORY");
if (values.NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK !== values.REGISTRY_DEPLOYMENT_BLOCK) throw new Error("NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK must match REGISTRY_DEPLOYMENT_BLOCK");

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head.toLowerCase() !== values.BUILD_COMMIT_SHA.toLowerCase()) throw new Error(`BUILD_COMMIT_SHA does not match checked-out HEAD ${head}`);
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("Real public evidence requires a clean committed worktree");

const requireFromRuntime = createRequire(new URL("../fixtures/runtime/package.json", import.meta.url));
const { privateKeyToAccount } = requireFromRuntime("viem/accounts");
const { decodeFunctionResult, encodeFunctionData, keccak256 } = requireFromRuntime("viem");
const keyPairs = [
  ["REGISTRY_WRITER_PRIVATE_KEY", "REGISTRY_WRITER_ADDRESS"],
  ["TARGET_PAYER_PRIVATE_KEY", "TARGET_PAYER_ADDRESS"],
  ["FIXTURE_HEALTHY_PROVIDER_PRIVATE_KEY", "FIXTURE_HEALTHY_PROVIDER_ADDRESS"],
  ["FIXTURE_INVALID_OUTPUT_PROVIDER_PRIVATE_KEY", "FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS"],
  ["FIXTURE_SCHEMA_DRIFT_PROVIDER_PRIVATE_KEY", "FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS"],
  ["FIXTURE_TIMEOUT_PROVIDER_PRIVATE_KEY", "FIXTURE_TIMEOUT_PROVIDER_ADDRESS"],
];
for (const [keyName, addressName] of keyPairs) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(values[keyName])) throw new Error(`${keyName} is invalid`);
  if (privateKeyToAccount(values[keyName]).address.toLowerCase() !== values[addressName].toLowerCase()) throw new Error(`${addressName} does not match ${keyName}`);
}
for (const [file, keyName, addressName] of [
  [".env.deployer.local", "DEPLOYER_PRIVATE_KEY", "DEPLOYER_ADDRESS"],
  [".env.payout.local", "PAYOUT_PRIVATE_KEY", "PAYOUT_ADDRESS"],
]) {
  if (!existsSync(file)) throw new Error(`${file} is required so ${addressName} is demonstrably controlled`);
  if ((statSync(file).mode & 0o077) !== 0) throw new Error(`${file} must not be readable by group or other users`);
  const match = readFileSync(file, "utf8").split(/\r?\n/).map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)).find((item) => item?.[1] === keyName);
  const privateKey = match?.[2];
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) throw new Error(`${file} does not contain a valid ${keyName}`);
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== values[addressName].toLowerCase()) throw new Error(`${addressName} does not match the segregated custody key in ${file}`);
}
const targetPayer = privateKeyToAccount(values.TARGET_PAYER_PRIVATE_KEY).address.toLowerCase();
for (const name of ["PAYOUT_ADDRESS", "DEPLOYER_ADDRESS"]) if (!/^0x[0-9a-fA-F]{40}$/.test(values[name]) || /^0x0{40}$/i.test(values[name])) throw new Error(`${name} is invalid`);
const roleAddresses = [values.REGISTRY_WRITER_ADDRESS, targetPayer, values.PAYOUT_ADDRESS, values.DEPLOYER_ADDRESS].map((value) => value.toLowerCase());
if (new Set(roleAddresses).size !== roleAddresses.length) throw new Error("Registry writer, target payer, payout, and deployer must be separate addresses");
const fixtureAddresses = keyPairs.slice(2).map(([, addressName]) => values[addressName].toLowerCase());
if (new Set(fixtureAddresses).size !== 4) throw new Error("Every fixture must have a unique provider address");
if (fixtureAddresses.some((address) => roleAddresses.includes(address))) throw new Error("Fixture provider identities must be separate from service wallet roles");

const fixtureUrls = [
  values.FIXTURE_HEALTHY_URL,
  values.FIXTURE_INVALID_OUTPUT_URL,
  values.FIXTURE_SCHEMA_DRIFT_URL,
  values.FIXTURE_TIMEOUT_URL,
];
if (new Set(fixtureUrls).size !== 4 || fixtureUrls.some((value) => !value.startsWith("https://") || new URL(value).origin !== value.replace(/\/$/, ""))) {
  throw new Error("Every public fixture needs a distinct HTTPS origin URL");
}
const allowlist = new Set(values.TARGET_ALLOWLIST.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
for (const fixtureUrl of fixtureUrls) if (!allowlist.has(new URL(fixtureUrl).hostname.toLowerCase())) throw new Error(`TARGET_ALLOWLIST does not contain ${new URL(fixtureUrl).hostname}`);
if (values.FIXTURE_PAYMENT_RECIPIENT.toLowerCase() !== values.PAYOUT_ADDRESS.toLowerCase()) throw new Error("FIXTURE_PAYMENT_RECIPIENT must match PAYOUT_ADDRESS for this controlled demo");
if (!/^[0-9]+$/.test(values.FIXTURE_PAYMENT_AMOUNT_ATOMIC) || BigInt(values.FIXTURE_PAYMENT_AMOUNT_ATOMIC) < 1n || BigInt(values.FIXTURE_PAYMENT_AMOUNT_ATOMIC) > 100_000n) {
  throw new Error("FIXTURE_PAYMENT_AMOUNT_ATOMIC must be between 1 and 100000 atomic units");
}
function usdt0Atomic(value, name) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value ?? "")) throw new Error(`${name} must be a nonnegative decimal with at most six places`);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
const perRunCapAtomic = usdt0Atomic(values.TARGET_PAYMENT_MAX_USDT0, "TARGET_PAYMENT_MAX_USDT0");
const dailyCapAtomic = usdt0Atomic(values.TARGET_PAYMENT_DAILY_LIMIT_USDT0, "TARGET_PAYMENT_DAILY_LIMIT_USDT0");
const fixtureAmountAtomic = BigInt(values.FIXTURE_PAYMENT_AMOUNT_ATOMIC);
if (perRunCapAtomic < 1n || perRunCapAtomic > 10_000_000n) throw new Error("TARGET_PAYMENT_MAX_USDT0 must be greater than zero and at most 10");
if (dailyCapAtomic < 1n || dailyCapAtomic > 100_000_000n) throw new Error("TARGET_PAYMENT_DAILY_LIMIT_USDT0 must be greater than zero and at most 100");
if (dailyCapAtomic < perRunCapAtomic) throw new Error("TARGET_PAYMENT_DAILY_LIMIT_USDT0 must be at least TARGET_PAYMENT_MAX_USDT0");
if (fixtureAmountAtomic > perRunCapAtomic || fixtureAmountAtomic > dailyCapAtomic) {
  throw new Error("Healthy fixture payment amount exceeds the configured per-run or daily target-payment cap");
}

if (!offline) {
  const registryAbi = [
    { type: "function", name: "writer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
    { type: "function", name: "MAX_EVIDENCE_BYTES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  ];
  const decimalsAbi = [
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  ];
  async function rpc(url, method, params = []) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status} at ${url}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`${method} failed at ${url}: ${payload.error.message}`);
    return payload.result;
  }
  for (const rpcUrl of [values.XLAYER_RPC_URL, values.XLAYER_FALLBACK_RPC_URL]) {
    const chainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
    if (chainId !== TESTNET_CHAIN_ID) throw new Error(`${rpcUrl} returned chain ${chainId}, expected ${TESTNET_CHAIN_ID}`);
  }
  const deploymentBlock = BigInt(values.REGISTRY_DEPLOYMENT_BLOCK);
  const latestBlock = BigInt(await rpc(values.XLAYER_RPC_URL, "eth_blockNumber"));
  if (deploymentBlock > latestBlock) throw new Error("REGISTRY_DEPLOYMENT_BLOCK is ahead of the current testnet block");
  const deploymentTag = `0x${deploymentBlock.toString(16)}`;
  const beforeDeploymentTag = `0x${(deploymentBlock - 1n).toString(16)}`;
  const [code, deploymentCode, beforeDeploymentCode] = await Promise.all([
    rpc(values.XLAYER_RPC_URL, "eth_getCode", [values.REGISTRY_ADDRESS, "latest"]),
    rpc(values.XLAYER_RPC_URL, "eth_getCode", [values.REGISTRY_ADDRESS, deploymentTag]),
    rpc(values.XLAYER_RPC_URL, "eth_getCode", [values.REGISTRY_ADDRESS, beforeDeploymentTag]),
  ]);
  if (!code || code === "0x") throw new Error("REGISTRY_ADDRESS has no runtime code");
  if (!deploymentCode || deploymentCode === "0x" || beforeDeploymentCode !== "0x") throw new Error("REGISTRY_DEPLOYMENT_BLOCK does not identify the registry creation boundary");
  if (keccak256(code).toLowerCase() !== values.REGISTRY_RUNTIME_CODE_HASH.toLowerCase()) throw new Error("Deployed registry runtime code hash does not match REGISTRY_RUNTIME_CODE_HASH");
  const writerData = encodeFunctionData({ abi: registryAbi, functionName: "writer" });
  const writerResult = await rpc(values.XLAYER_RPC_URL, "eth_call", [{ to: values.REGISTRY_ADDRESS, data: writerData }, "latest"]);
  const writer = decodeFunctionResult({ abi: registryAbi, functionName: "writer", data: writerResult });
  if (writer.toLowerCase() !== values.REGISTRY_WRITER_ADDRESS.toLowerCase()) throw new Error("Deployed registry writer does not match REGISTRY_WRITER_ADDRESS");
  const maxEvidenceData = encodeFunctionData({ abi: registryAbi, functionName: "MAX_EVIDENCE_BYTES" });
  const maxEvidenceResult = await rpc(values.XLAYER_RPC_URL, "eth_call", [{ to: values.REGISTRY_ADDRESS, data: maxEvidenceData }, "latest"]);
  const maxEvidence = decodeFunctionResult({ abi: registryAbi, functionName: "MAX_EVIDENCE_BYTES", data: maxEvidenceResult });
  if (maxEvidence !== 65_536n) throw new Error("Deployed registry exposes an unexpected evidence size limit");
  const assetCode = await rpc(values.XLAYER_RPC_URL, "eth_getCode", [values.XLAYER_USDT0_ADDRESS, "latest"]);
  if (!assetCode || assetCode === "0x") throw new Error("XLAYER_USDT0_ADDRESS has no runtime code on testnet");
  const decimalsData = encodeFunctionData({ abi: decimalsAbi, functionName: "decimals" });
  const decimalsResult = await rpc(values.XLAYER_RPC_URL, "eth_call", [{ to: values.XLAYER_USDT0_ADDRESS, data: decimalsData }, "latest"]);
  const decimals = decodeFunctionResult({ abi: decimalsAbi, functionName: "decimals", data: decimalsResult });
  if (Number(decimals) !== 6) throw new Error("Configured testnet USD₮0 does not expose 6 decimals");
  const [writerNativeHex, targetNativeHex] = await Promise.all([
    rpc(values.XLAYER_RPC_URL, "eth_getBalance", [values.REGISTRY_WRITER_ADDRESS, "latest"]),
    rpc(values.XLAYER_RPC_URL, "eth_getBalance", [values.TARGET_PAYER_ADDRESS, "latest"]),
  ]);
  if (BigInt(writerNativeHex) === 0n) throw new Error("REGISTRY_WRITER_ADDRESS has no test OKB for evidence-publication gas");
  if (BigInt(targetNativeHex) === 0n) throw new Error("TARGET_PAYER_ADDRESS has no test OKB required by the backend target-payment preflight policy");
  const targetBalanceData = encodeFunctionData({ abi: decimalsAbi, functionName: "balanceOf", args: [values.TARGET_PAYER_ADDRESS] });
  const targetBalanceResult = await rpc(values.XLAYER_RPC_URL, "eth_call", [{ to: values.XLAYER_USDT0_ADDRESS, data: targetBalanceData }, "latest"]);
  const targetTokenBalance = decodeFunctionResult({ abi: decimalsAbi, functionName: "balanceOf", data: targetBalanceResult });
  const requiredTargetBalance = perRunCapAtomic > fixtureAmountAtomic ? perRunCapAtomic : fixtureAmountAtomic;
  if (targetTokenBalance < requiredTargetBalance) {
    throw new Error(`TARGET_PAYER_ADDRESS needs at least ${requiredTargetBalance} atomic test USD₮0 units for the configured fixture/cap policy`);
  }
  const { OKXFacilitatorClient } = requireFromRuntime("@okxweb3/x402-core");
  const facilitator = new OKXFacilitatorClient({
    apiKey: values.OKX_API_KEY,
    secretKey: values.OKX_SECRET_KEY,
    passphrase: values.OKX_PASSPHRASE,
    baseUrl: values.OKX_BASE_URL,
    syncSettle: true,
  });
  const supported = await facilitator.getSupported();
  if (!supported.kinds.some((kind) => kind.scheme === "exact" && kind.network === TESTNET_NETWORK)) {
    throw new Error(`OKX facilitator does not advertise exact settlement for ${TESTNET_NETWORK}`);
  }
  const variants = ["healthy", "invalid-output", "schema-drift", "timeout"];
  const verifier = fileURLToPath(new URL("./verify-fixture-manifest.mjs", import.meta.url));
  for (const [index, fixtureUrl] of fixtureUrls.entries()) {
    const paymentMode = index === 0 ? "x402_optional" : "none";
    const output = execFileSync(
      process.execPath,
      [
        verifier,
        fixtureUrl,
        values.BUILD_COMMIT_SHA,
        fixtureUrl,
        variants[index],
        TESTNET_NETWORK,
        TESTNET_USDT0,
        paymentMode,
        values.FIXTURE_PAYMENT_RECIPIENT,
        values.FIXTURE_PAYMENT_AMOUNT_ATOMIC,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    const verifiedManifest = JSON.parse(output);
    if (verifiedManifest.provider_address.toLowerCase() !== fixtureAddresses[index]) {
      throw new Error(`${variants[index]} fixture manifest provider does not match its configured public address`);
    }
  }
}

process.stdout.write(`X Layer testnet configuration validated${offline ? " (static checks only)" : " against both RPCs, deployed code, facilitator support, and signed fixtures"}. No transaction was sent.\n`);

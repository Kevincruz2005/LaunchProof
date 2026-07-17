import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const transactionHash = process.argv.slice(2).find((argument) => argument !== "--");
if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash ?? "")) {
  throw new Error("usage: node scripts/record-testnet-deployment.mjs DEPLOYMENT_TX_HASH");
}

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
if (!existsSync(envFile)) throw new Error(".env does not exist");
if ((statSync(envFile).mode & 0o077) !== 0) throw new Error(".env must not be readable by group or other users");
const values = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}
const rpcUrl = values.XLAYER_RPC_URL;
const expectedWriter = values.REGISTRY_WRITER_ADDRESS;
if (!rpcUrl) throw new Error("XLAYER_RPC_URL is required in .env");
if (values.XLAYER_TESTNET !== "true" || values.ALLOW_XLAYER_MAINNET !== "false" || values.XLAYER_CHAIN_ID !== "1952" || values.XLAYER_NETWORK !== "eip155:1952") {
  throw new Error("Deployment recording is restricted to the X Layer testnet profile");
}
const parsedRpcUrl = new URL(rpcUrl);
if (parsedRpcUrl.protocol !== "https:" || parsedRpcUrl.username || parsedRpcUrl.password) throw new Error("XLAYER_RPC_URL must be HTTPS without embedded credentials");
if (!/^0x[0-9a-fA-F]{40}$/.test(expectedWriter ?? "")) throw new Error("REGISTRY_WRITER_ADDRESS is required in .env");
if (!/^0x[0-9a-fA-F]{64}$/.test(values.REGISTRY_WRITER_PRIVATE_KEY ?? "")) throw new Error("REGISTRY_WRITER_PRIVATE_KEY is required in .env");
const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-fA-F]{40}$/.test(values.BUILD_COMMIT_SHA ?? "") || values.BUILD_COMMIT_SHA.toLowerCase() !== head.toLowerCase()) {
  throw new Error("BUILD_COMMIT_SHA must match the checked-out commit before recording a deployment");
}
if (execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()) {
  throw new Error("Deployment recording requires a clean committed worktree");
}

const requireFromRuntime = createRequire(new URL("../fixtures/runtime/package.json", import.meta.url));
const { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, toHex } = requireFromRuntime("viem");
const { privateKeyToAccount } = requireFromRuntime("viem/accounts");
if (privateKeyToAccount(values.REGISTRY_WRITER_PRIVATE_KEY).address.toLowerCase() !== expectedWriter.toLowerCase()) {
  throw new Error("REGISTRY_WRITER_PRIVATE_KEY does not match REGISTRY_WRITER_ADDRESS");
}
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} failed: ${payload.error.message}`);
  return payload.result;
}

const chainId = Number.parseInt(await rpc("eth_chainId"), 16);
if (chainId !== 1952) throw new Error(`RPC returned chain ${chainId}; expected X Layer testnet 1952`);
const transaction = await rpc("eth_getTransactionByHash", [transactionHash]);
if (!transaction) throw new Error("Deployment transaction is not available");
if (transaction.to !== null) throw new Error("Transaction is not a contract creation");
if (!/^0x[0-9a-fA-F]{40}$/.test(values.DEPLOYER_ADDRESS ?? "") || /^0x0{40}$/i.test(values.DEPLOYER_ADDRESS)) throw new Error("DEPLOYER_ADDRESS is invalid");
if (transaction.from.toLowerCase() !== values.DEPLOYER_ADDRESS.toLowerCase()) {
  throw new Error("Deployment transaction sender does not match DEPLOYER_ADDRESS");
}
const artifactPath = resolve(root, "contracts", "out", "LaunchProofRegistry.sol", "LaunchProofRegistry.json");
if (!existsSync(artifactPath)) throw new Error("Foundry artifact is missing; run `forge build --root contracts` from this exact clean commit first");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const creationBytecode = typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode?.object;
if (!/^0x[0-9a-fA-F]+$/.test(creationBytecode ?? "")) throw new Error("Foundry artifact does not contain LaunchProofRegistry creation bytecode");
const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
const registryMetadata = Object.entries(metadata?.sources ?? {}).find(([name]) => name.endsWith("src/LaunchProofRegistry.sol"));
const localSource = readFileSync(resolve(root, "contracts", "src", "LaunchProofRegistry.sol"), "utf8");
if (!registryMetadata || registryMetadata[1]?.keccak256?.toLowerCase() !== keccak256(toHex(localSource)).toLowerCase()) {
  throw new Error("Foundry artifact source hash does not match contracts/src/LaunchProofRegistry.sol; run forge build again");
}
const constructorArguments = encodeAbiParameters([{ type: "address" }], [expectedWriter]);
const expectedCreateInput = `${creationBytecode}${constructorArguments.slice(2)}`.toLowerCase();
if ((transaction.input ?? "").toLowerCase() !== expectedCreateInput) {
  throw new Error("Deployment CREATE input does not match the locally built LaunchProofRegistry bytecode and expected writer constructor argument");
}
const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
if (!receipt) throw new Error("Deployment receipt is not available yet");
if (receipt.status !== "0x1") throw new Error("Deployment transaction failed");
if (!/^0x[0-9a-fA-F]{40}$/.test(receipt.contractAddress ?? "")) throw new Error("Transaction receipt does not contain a deployed contract address");
const address = receipt.contractAddress;
const block = BigInt(receipt.blockNumber);
if (block < 1n) throw new Error("Deployment block is invalid");
const code = await rpc("eth_getCode", [address, "latest"]);
if (!code || code === "0x") throw new Error("Deployment address has no runtime code");
const deploymentCode = await rpc("eth_getCode", [address, `0x${block.toString(16)}`]);
if (deploymentCode.toLowerCase() !== code.toLowerCase()) throw new Error("Runtime code at the deployment block does not match current runtime code");
const previousCode = await rpc("eth_getCode", [address, `0x${(block - 1n).toString(16)}`]);
if (previousCode !== "0x") throw new Error("Contract code existed before the claimed deployment block");

const abi = [
  { type: "function", name: "writer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MAX_EVIDENCE_BYTES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];
async function read(functionName) {
  const data = encodeFunctionData({ abi, functionName });
  const result = await rpc("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: result });
}
const writer = await read("writer");
if (writer.toLowerCase() !== expectedWriter.toLowerCase()) throw new Error("Deployed registry writer does not match REGISTRY_WRITER_ADDRESS");
const maxEvidenceBytes = await read("MAX_EVIDENCE_BYTES");
if (maxEvidenceBytes !== 65_536n) throw new Error(`Unexpected MAX_EVIDENCE_BYTES: ${maxEvidenceBytes}`);
const runtimeCodeHash = keccak256(code);

const updates = new Map([
  ["REGISTRY_ADDRESS", address],
  ["REGISTRY_DEPLOYMENT_BLOCK", block.toString()],
  ["REGISTRY_RUNTIME_CODE_HASH", runtimeCodeHash],
  ["NEXT_PUBLIC_REGISTRY_ADDRESS", address],
  ["NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK", block.toString()],
]);
const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
const seen = new Set();
const next = lines.map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (!match || !updates.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${updates.get(match[1])}`;
});
for (const [key, value] of updates) if (!seen.has(key)) next.push(`${key}=${value}`);
writeFileSync(envFile, `${next.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
chmodSync(envFile, 0o600);

process.stdout.write(`${JSON.stringify({
  network: "eip155:1952",
  transaction_hash: transactionHash,
  registry_address: address,
  deployment_block: block.toString(),
  runtime_code_hash: runtimeCodeHash,
  create_input_matches_local_artifact: true,
  writer,
  max_evidence_bytes: maxEvidenceBytes.toString(),
  env_updated: true,
}, null, 2)}\n`);
process.stdout.write("Read-only verification completed; no transaction was sent.\n");

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
const deployerFile = resolve(root, ".env.deployer.local");
if (!existsSync(envFile) || !existsSync(deployerFile)) {
  throw new Error("Run `cp .env.example .env` and `pnpm keys:testnet` before deployment");
}
if ((statSync(envFile).mode & 0o077) !== 0) throw new Error(".env must not be readable by group or other users");
if ((statSync(deployerFile).mode & 0o077) !== 0) throw new Error(".env.deployer.local must not be readable by group or other users");

function parse(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const config = parse(envFile);
const deployer = parse(deployerFile);
if (config.XLAYER_TESTNET !== "true" || config.ALLOW_XLAYER_MAINNET !== "false") throw new Error("Registry deployment wrapper is testnet-only");
if (config.XLAYER_CHAIN_ID !== "1952" || config.XLAYER_NETWORK !== "eip155:1952") throw new Error("Registry deployment requires X Layer testnet chain 1952");
const rpcUrl = new URL(config.XLAYER_RPC_URL ?? "invalid:");
if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password) throw new Error("XLAYER_RPC_URL must be an HTTPS URL without embedded credentials");
if (!/^0x[0-9a-fA-F]{40}$/.test(config.REGISTRY_WRITER_ADDRESS ?? "") || /^0x0{40}$/i.test(config.REGISTRY_WRITER_ADDRESS)) {
  throw new Error("REGISTRY_WRITER_ADDRESS must be a nonzero EVM address");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(config.REGISTRY_WRITER_PRIVATE_KEY ?? "")) throw new Error("REGISTRY_WRITER_PRIVATE_KEY is invalid");
if (!/^0x[0-9a-fA-F]{64}$/.test(deployer.DEPLOYER_PRIVATE_KEY ?? "")) throw new Error(".env.deployer.local does not contain a valid DEPLOYER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{40}$/.test(config.DEPLOYER_ADDRESS ?? "") || /^0x0{40}$/i.test(config.DEPLOYER_ADDRESS)) throw new Error("DEPLOYER_ADDRESS is invalid");
const requireFromRuntime = createRequire(new URL("../fixtures/runtime/package.json", import.meta.url));
const { privateKeyToAccount } = requireFromRuntime("viem/accounts");
if (privateKeyToAccount(config.REGISTRY_WRITER_PRIVATE_KEY).address.toLowerCase() !== config.REGISTRY_WRITER_ADDRESS.toLowerCase()) {
  throw new Error("REGISTRY_WRITER_PRIVATE_KEY does not match REGISTRY_WRITER_ADDRESS; refusing to create an unusable immutable registry");
}
if (privateKeyToAccount(deployer.DEPLOYER_PRIVATE_KEY).address.toLowerCase() !== config.DEPLOYER_ADDRESS.toLowerCase()) {
  throw new Error("DEPLOYER_PRIVATE_KEY does not match DEPLOYER_ADDRESS");
}
if (config.REGISTRY_WRITER_ADDRESS.toLowerCase() === config.DEPLOYER_ADDRESS.toLowerCase()) throw new Error("Registry writer and deployer must be separate roles");
const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (config.BUILD_COMMIT_SHA?.toLowerCase() !== head.toLowerCase()) throw new Error("BUILD_COMMIT_SHA must match the checked-out commit before deployment");
if (execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("Registry deployment requires a clean committed worktree");

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
const rpcChainId = Number.parseInt(await rpc("eth_chainId"), 16);
if (rpcChainId !== 1952) throw new Error(`Deployment RPC returned chain ${rpcChainId}; expected X Layer testnet 1952`);
const deployerBalance = BigInt(await rpc("eth_getBalance", [config.DEPLOYER_ADDRESS, "latest"]));
if (deployerBalance === 0n) throw new Error("DEPLOYER_ADDRESS has no test OKB; fund it before broadcasting the registry deployment");

const allowInherited = [
  "PATH",
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "TERM",
];
const childEnv = Object.fromEntries(allowInherited.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
Object.assign(childEnv, {
  XLAYER_CHAIN_ID: config.XLAYER_CHAIN_ID,
  REGISTRY_WRITER_ADDRESS: config.REGISTRY_WRITER_ADDRESS,
  DEPLOYER_PRIVATE_KEY: deployer.DEPLOYER_PRIVATE_KEY,
});

process.stdout.write(`Broadcasting the locally built registry to eip155:1952 with writer ${config.REGISTRY_WRITER_ADDRESS}. No secret is printed.\n`);
const result = spawnSync(
  "forge",
  ["script", "--root", "contracts", "script/Deploy.s.sol:Deploy", "--rpc-url", rpcUrl.toString(), "--broadcast"],
  { cwd: root, env: childEnv, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

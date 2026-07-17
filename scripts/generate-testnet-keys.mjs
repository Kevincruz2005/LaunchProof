import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envFile = resolve(root, ".env");
const deployerFile = resolve(root, ".env.deployer.local");
const payoutFile = resolve(root, ".env.payout.local");
const force = process.argv.includes("--force");
const requireFromRuntime = createRequire(new URL("../fixtures/runtime/package.json", import.meta.url));
const { generatePrivateKey, privateKeyToAccount } = requireFromRuntime("viem/accounts");

if (!existsSync(envFile)) copyFileSync(resolve(root, ".env.example"), envFile);

function parse(file) {
  const values = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function serialize(file, values, removedNames = new Set()) {
  const existing = readFileSync(file, "utf8").split(/\r?\n/);
  const seen = new Set();
  const lines = existing.flatMap((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match && removedNames.has(match[1])) return [];
    if (!match || !values.has(match[1])) return [line];
    seen.add(match[1]);
    return [`${match[1]}=${values.get(match[1])}`];
  });
  for (const [name, value] of values) if (!seen.has(name)) lines.push(`${name}=${value}`);
  writeFileSync(file, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

const env = parse(envFile);
if (force) {
  for (const [name, value] of [
    ["REGISTRY_ADDRESS", ""],
    ["REGISTRY_DEPLOYMENT_BLOCK", "0"],
    ["REGISTRY_RUNTIME_CODE_HASH", ""],
    ["NEXT_PUBLIC_REGISTRY_ADDRESS", ""],
    ["NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK", "0"],
    ["REFERENCE_PAYMENT_ID", ""],
  ]) env.set(name, value);
}
const roles = [
  ["REGISTRY_WRITER_PRIVATE_KEY", "REGISTRY_WRITER_ADDRESS"],
  ["TARGET_PAYER_PRIVATE_KEY", "TARGET_PAYER_ADDRESS"],
  ["FIXTURE_HEALTHY_PROVIDER_PRIVATE_KEY", "FIXTURE_HEALTHY_PROVIDER_ADDRESS"],
  ["FIXTURE_INVALID_OUTPUT_PROVIDER_PRIVATE_KEY", "FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS"],
  ["FIXTURE_SCHEMA_DRIFT_PROVIDER_PRIVATE_KEY", "FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS"],
  ["FIXTURE_TIMEOUT_PROVIDER_PRIVATE_KEY", "FIXTURE_TIMEOUT_PROVIDER_ADDRESS"],
];

const publicAddresses = [];
for (const [keyName, addressName] of roles) {
  let key = env.get(keyName);
  if (force || !key) key = generatePrivateKey();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${keyName} is set but is not a private key; fix it or rerun with --force`);
  const address = privateKeyToAccount(key).address;
  env.set(keyName, key);
  env.set(addressName, address);
  publicAddresses.push([addressName, address]);
}

let payoutKey;
if (!force && existsSync(payoutFile)) payoutKey = parse(payoutFile).get("PAYOUT_PRIVATE_KEY");
if (!force && !payoutKey) payoutKey = env.get("PAYOUT_PRIVATE_KEY");
if (!payoutKey) payoutKey = generatePrivateKey();
if (!/^0x[0-9a-fA-F]{64}$/.test(payoutKey)) throw new Error(`${payoutFile} contains an invalid PAYOUT_PRIVATE_KEY`);
writeFileSync(payoutFile, `PAYOUT_PRIVATE_KEY=${payoutKey}\n`, { mode: 0o600 });
chmodSync(payoutFile, 0o600);
const payoutAddress = privateKeyToAccount(payoutKey).address;
env.set("PAYOUT_ADDRESS", payoutAddress);
env.set("FIXTURE_PAYMENT_RECIPIENT", payoutAddress);
env.set("NEXT_PUBLIC_PAYOUT_ADDRESS", payoutAddress);
publicAddresses.push(["PAYOUT_ADDRESS", payoutAddress]);

let deployerKey;
if (!force && existsSync(deployerFile)) deployerKey = parse(deployerFile).get("DEPLOYER_PRIVATE_KEY");
if (!deployerKey) deployerKey = generatePrivateKey();
if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) throw new Error(`${deployerFile} contains an invalid DEPLOYER_PRIVATE_KEY`);
writeFileSync(deployerFile, `DEPLOYER_PRIVATE_KEY=${deployerKey}\n`, { mode: 0o600 });
chmodSync(deployerFile, 0o600);
const deployerAddress = privateKeyToAccount(deployerKey).address;
env.set("DEPLOYER_ADDRESS", deployerAddress);
publicAddresses.push(["DEPLOYER_ADDRESS", deployerAddress]);
const normalizedAddresses = publicAddresses.map(([, address]) => address.toLowerCase());
if (new Set(normalizedAddresses).size !== normalizedAddresses.length) {
  throw new Error("Wallet roles are not unique; rerun with --force to generate separated identities");
}
env.delete("PAYOUT_PRIVATE_KEY");
env.delete("DEPLOYER_PRIVATE_KEY");
serialize(envFile, env, new Set(["PAYOUT_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]));

process.stdout.write("Generated or retained unique keys in ignored mode-0600 files. Private keys were not printed.\n");
if (force) process.stdout.write("Cleared stale registry deployment metadata because the writer identity was rotated.\n");
for (const [name, address] of publicAddresses) process.stdout.write(`${name}=${address}\n`);
process.stdout.write(`Deployer secret: ${deployerFile}\nApplication and fixture secrets: ${envFile}\n`);
process.stdout.write(`Payout custody secret: ${payoutFile} (back it up securely; it is not loaded by LaunchProof)\n`);

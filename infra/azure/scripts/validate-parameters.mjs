import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [file, mode = "example"] = process.argv.slice(2);
if (!file || !new Set(["example", "deployment", "active"]).has(mode)) {
  throw new Error("usage: validate-parameters.mjs <parameters.json> <example|deployment|active>");
}

const parsed = JSON.parse(readFileSync(file, "utf8"));
const parameters = Object.fromEntries(Object.entries(parsed.parameters ?? {}).map(([name, entry]) => [name, entry.value]));
const required = [
  "namePrefix", "activationMode", "writerCutoverApproved", "deployWorkloads", "deployBackend", "buildCommit",
  "sourceRepositoryUrl", "vercelWebOrigin", "containerRegistrySubscriptionId", "containerRegistryResourceGroup",
  "containerRegistryName", "containerRegistryServer", "backendImage", "healthyFixtureImage",
  "invalidOutputFixtureImage", "schemaDriftFixtureImage", "timeoutFixtureImage", "xlayerRpcUrl",
  "xlayerFallbackRpcUrl", "xlayerExplorerUrl", "xlayerUsdt0Address", "registryAddress",
  "registryDeploymentBlock", "registryRuntimeCodeHash", "payoutAddress", "fixturePaymentRecipient",
  "healthyProviderAddress", "invalidOutputProviderAddress", "schemaDriftProviderAddress", "timeoutProviderAddress",
  "okxBaseUrl", "budgetStartDate", "budgetEndDate",
];
for (const name of required) if (!(name in parameters)) throw new Error(`missing parameter ${name}`);

const serialized = JSON.stringify(parameters);
if (/(private.?key|secret.?key|passphrase|database.?url)"\s*:/i.test(serialized)) {
  throw new Error("parameter files must never contain secret/database/private-key fields");
}
if (mode === "example") {
  if (!serialized.includes("REPLACE_")) throw new Error("example parameters must remain visibly non-deployable");
  if (parameters.activationMode !== "read-only" || parameters.writerCutoverApproved !== false || parameters.deployBackend !== true) {
    throw new Error("example parameters must default to a deployed read-only backend");
  }
  process.stdout.write("Azure example parameters are non-secret and intentionally non-deployable.\n");
  process.exit(0);
}

if (/REPLACE_|placeholder|example\.com/i.test(serialized)) throw new Error("deployment parameters contain a placeholder");
if (!/^[a-z][a-z0-9-]{2,14}$/.test(parameters.namePrefix)) throw new Error("namePrefix must be 3-15 lowercase letters, digits, or hyphens and start with a letter");
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parameters.containerRegistrySubscriptionId)) {
  throw new Error("containerRegistrySubscriptionId must be a UUID");
}
if (!/^(?![.])[A-Za-z0-9_.()-]{1,90}(?<![.])$/.test(parameters.containerRegistryResourceGroup)) {
  throw new Error("containerRegistryResourceGroup is invalid");
}
if (!/^[0-9a-f]{40}$/i.test(parameters.buildCommit)) throw new Error("buildCommit must be a full Git SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (parameters.buildCommit.toLowerCase() !== head.toLowerCase()) throw new Error("buildCommit must equal the checked-out immutable HEAD");

const httpsOrigin = (name) => {
  const url = new URL(parameters[name]);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${name} must be a credential-free HTTPS origin`);
  }
  const host = url.hostname.toLowerCase();
  if (host.includes("*") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".invalid") || host.endsWith(".example") || host.includes("placeholder")) {
    throw new Error(`${name} must use a public non-placeholder hostname`);
  }
};
httpsOrigin("vercelWebOrigin");
httpsOrigin("okxBaseUrl");
if (parameters.okxBaseUrl !== "https://web3.okx.com") throw new Error("okxBaseUrl must be the official OKX Web3 origin");
if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i.test(parameters.sourceRepositoryUrl)) {
  throw new Error("sourceRepositoryUrl must be a public GitHub repository URL");
}
for (const name of ["xlayerRpcUrl", "xlayerFallbackRpcUrl", "xlayerExplorerUrl", "sourceRepositoryUrl"]) {
  const url = new URL(parameters[name]);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${name} must be credential-free HTTPS`);
  if (url.hostname.endsWith(".invalid") || url.hostname.endsWith(".example") || url.hostname === "localhost") throw new Error(`${name} must be public and non-placeholder`);
}
if (parameters.xlayerRpcUrl === parameters.xlayerFallbackRpcUrl) throw new Error("primary and fallback X Layer RPC URLs must be independent");

if (!/^[a-z0-9]{5,50}$/.test(parameters.containerRegistryName)) throw new Error("containerRegistryName is invalid");
if (parameters.containerRegistryServer !== `${parameters.containerRegistryName}.azurecr.io`) throw new Error("registry server/name mismatch");
const images = ["backendImage", "healthyFixtureImage", "invalidOutputFixtureImage", "schemaDriftFixtureImage", "timeoutFixtureImage"];
for (const name of images) {
  const expected = new RegExp(`^${parameters.containerRegistryServer.replaceAll(".", "\\.")}\\/[a-z0-9._/-]+:${parameters.buildCommit}@sha256:[0-9a-f]{64}$`, "i");
  if (!expected.test(parameters[name])) throw new Error(`${name} must be an immutable image digest from the approved existing ACR`);
}
for (const [name, maximum] of [["targetPaymentMaxUsdt0", 10], ["targetPaymentDailyLimitUsdt0", 100]]) {
  if (typeof parameters[name] !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(parameters[name]) || Number(parameters[name]) <= 0 || Number(parameters[name]) > maximum) {
    throw new Error(`${name} must be a positive bounded decimal string`);
  }
}
if (Number(parameters.targetPaymentDailyLimitUsdt0) < Number(parameters.targetPaymentMaxUsdt0)) {
  throw new Error("targetPaymentDailyLimitUsdt0 must be greater than or equal to targetPaymentMaxUsdt0");
}

const address = /^0x(?!0{40}$)[0-9a-f]{40}$/i;
for (const name of ["xlayerUsdt0Address", "registryAddress", "payoutAddress", "fixturePaymentRecipient", "healthyProviderAddress", "invalidOutputProviderAddress", "schemaDriftProviderAddress", "timeoutProviderAddress"]) {
  if (!address.test(parameters[name])) throw new Error(`${name} must be a nonzero EVM address`);
}
if (parameters.xlayerUsdt0Address.toLowerCase() !== "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c") {
  throw new Error("xlayerUsdt0Address is not the official X Layer testnet USD₮0 asset");
}
if (!/^0x[0-9a-f]{64}$/i.test(parameters.registryRuntimeCodeHash)) throw new Error("registryRuntimeCodeHash must be bytes32");
if (!/^[1-9]\d*$/.test(parameters.registryDeploymentBlock)) throw new Error("registryDeploymentBlock must be a positive decimal block");
const productionRoleAddresses = [parameters.registryAddress, parameters.payoutAddress, parameters.healthyProviderAddress, parameters.invalidOutputProviderAddress, parameters.schemaDriftProviderAddress, parameters.timeoutProviderAddress].map((value) => value.toLowerCase());
if (new Set(productionRoleAddresses).size !== productionRoleAddresses.length) {
  throw new Error("registry, payout, and controlled fixture declaration identities must be distinct");
}

if (typeof parameters.deployWorkloads !== "boolean" || typeof parameters.deployBackend !== "boolean") {
  throw new Error("deployWorkloads and deployBackend must be booleans");
}
if (mode === "active") {
  if (parameters.activationMode !== "active" || parameters.writerCutoverApproved !== true || parameters.deployWorkloads !== true || parameters.deployBackend !== true) {
    throw new Error("active deployment requires activationMode=active, writerCutoverApproved=true, deployWorkloads=true, and deployBackend=true");
  }
} else if (parameters.activationMode !== "read-only" || parameters.writerCutoverApproved !== false) {
  throw new Error("candidate deployment must use the read-only backend mode");
} else if (parameters.deployBackend && !parameters.deployWorkloads) {
  throw new Error("read-only backend deployment requires all four fixture workloads");
}
if (parameters.enableBudget && (!Array.isArray(parameters.budgetContactEmails) || parameters.budgetContactEmails.length === 0)) {
  throw new Error("enabled budget requires at least one contact email");
}
const budgetDate = /^\d{4}-\d{2}-01$/;
const budgetStart = Date.parse(`${parameters.budgetStartDate}T00:00:00Z`);
const budgetEnd = Date.parse(`${parameters.budgetEndDate}T00:00:00Z`);
if (!budgetDate.test(parameters.budgetStartDate) || !budgetDate.test(parameters.budgetEndDate) || !Number.isFinite(budgetStart) || !Number.isFinite(budgetEnd) || budgetEnd <= budgetStart) {
  throw new Error("budget dates must be valid first-of-month dates with budgetEndDate after budgetStartDate");
}
process.stdout.write(`Azure ${mode} parameters passed fail-closed validation.\n`);

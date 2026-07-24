import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const azureDirectory = resolve(process.argv[2] ?? "infra/azure");
const validator = join(azureDirectory, "scripts/validate-parameters.mjs");
const example = JSON.parse(readFileSync(join(azureDirectory, "parameters/candidate.parameters.example.json"), "utf8"));
const values = example.parameters;
const set = (name, value) => { values[name].value = value; };
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const fixtureCommit = "2".repeat(40);
const registry = "syntheticlaunchproofacr";
set("buildCommit", head);
set("fixtureBuildCommit", fixtureCommit);
set("sourceRepositoryUrl", "https://github.com/example/launchproof");
set("vercelWebOrigin", "https://launchproof.dev");
set("containerRegistrySubscriptionId", "11111111-2222-3333-4444-555555555555");
set("containerRegistryResourceGroup", "launchproof-registry-rg");
set("containerRegistryName", registry);
set("containerRegistryServer", `${registry}.azurecr.io`);
set("backendImage", `${registry}.azurecr.io/launchproof/backend:${head}@sha256:${"a".repeat(64)}`);
for (const [name, repository, byte] of [
  ["healthyFixtureImage", "fixture-healthy", "b"],
  ["invalidOutputFixtureImage", "fixture-invalid", "c"],
  ["schemaDriftFixtureImage", "fixture-drift", "d"],
  ["timeoutFixtureImage", "fixture-timeout", "e"],
]) set(name, `${registry}.azurecr.io/launchproof/${repository}:${fixtureCommit}@sha256:${byte.repeat(64)}`);
set("xlayerRpcUrl", "https://testrpc.xlayer.tech");
set("xlayerFallbackRpcUrl", "https://xlayertestrpc.okx.com");
set("xlayerExplorerUrl", "https://www.okx.com/web3/explorer/xlayer-test");
set("xlayerUsdt0Address", "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c");
set("registryAddress", `0x${"11".repeat(20)}`);
set("registryDeploymentBlock", "1");
set("registryRuntimeCodeHash", `0x${"12".repeat(32)}`);
set("payoutAddress", `0x${"21".repeat(20)}`);
set("fixturePaymentRecipient", `0x${"22".repeat(20)}`);
set("healthyProviderAddress", `0x${"31".repeat(20)}`);
set("invalidOutputProviderAddress", `0x${"32".repeat(20)}`);
set("schemaDriftProviderAddress", `0x${"33".repeat(20)}`);
set("timeoutProviderAddress", `0x${"34".repeat(20)}`);

const directory = mkdtempSync(join(tmpdir(), "launchproof-azure-"));
const file = join(directory, "parameters.json");
const write = (document) => writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
const validate = (mode, shouldPass, message) => {
  const result = spawnSync(process.execPath, [validator, file, mode], { encoding: "utf8" });
  if ((result.status === 0) !== shouldPass) throw new Error(`${message}: ${result.stderr || result.stdout}`);
};

try {
  write(example);
  validate("deployment", true, "valid candidate plan was rejected");

  const active = structuredClone(example);
  active.parameters.activationMode.value = "active";
  active.parameters.writerCutoverApproved.value = true;
  active.parameters.deployBackend.value = true;
  write(active);
  validate("active", true, "valid active cutover was rejected");

  const unsafeCases = [
    ["wrong testnet asset", (document) => { document.parameters.xlayerUsdt0Address.value = `0x${"99".repeat(20)}`; }],
    ["mutable image", (document) => { document.parameters.backendImage.value = `${registry}.azurecr.io/launchproof/backend:latest`; }],
    ["fixture tagged as backend", (document) => { document.parameters.healthyFixtureImage.value = `${registry}.azurecr.io/launchproof/fixture-healthy:${head}@sha256:${"b".repeat(64)}`; }],
    ["invalid fixture commit", (document) => { document.parameters.fixtureBuildCommit.value = "not-a-commit"; }],
    ["wildcard frontend", (document) => { document.parameters.vercelWebOrigin.value = "https://*"; }],
    ["active without approval", (document) => { document.parameters.activationMode.value = "active"; document.parameters.writerCutoverApproved.value = false; }],
    ["active without workloads", (document) => { document.parameters.activationMode.value = "active"; document.parameters.writerCutoverApproved.value = true; document.parameters.deployWorkloads.value = false; }],
    ["active without backend", (document) => { document.parameters.activationMode.value = "active"; document.parameters.writerCutoverApproved.value = true; document.parameters.deployBackend.value = false; }],
    ["read-only backend without fixtures", (document) => { document.parameters.deployWorkloads.value = false; document.parameters.deployBackend.value = true; }],
    ["duplicate provider", (document) => { document.parameters.timeoutProviderAddress.value = document.parameters.healthyProviderAddress.value; }],
    ["daily payment cap below per-run cap", (document) => { document.parameters.targetPaymentDailyLimitUsdt0.value = "0.01"; }],
    ["invalid resource prefix", (document) => { document.parameters.namePrefix.value = "Launch Proof"; }],
    ["same primary and fallback RPC", (document) => { document.parameters.xlayerFallbackRpcUrl.value = document.parameters.xlayerRpcUrl.value; }],
    ["invalid budget date", (document) => { document.parameters.budgetStartDate.value = "2026-08-15"; }],
  ];
  for (const [name, mutate] of unsafeCases) {
    const document = structuredClone(example);
    mutate(document);
    write(document);
    validate(document.parameters.activationMode.value === "active" ? "active" : "deployment", false, `${name} was accepted`);
  }
  process.stdout.write("Azure parameter safety tests passed.\n");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

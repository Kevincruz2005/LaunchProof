import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const azureDirectory = resolve(process.argv[2] ?? "infra/azure");
const validator = join(azureDirectory, "scripts/validate-resource-group-parameters.mjs");
const example = JSON.parse(readFileSync(join(azureDirectory, "parameters/resource-group.parameters.example.json"), "utf8"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
example.parameters.resourceGroupName.value = "launchproof-candidate-rg";
example.parameters.location.value = "centralindia";
example.parameters.buildCommit.value = head;

const directory = mkdtempSync(join(tmpdir(), "launchproof-azure-rg-"));
const file = join(directory, "parameters.json");
const write = (document) => writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
const validate = (shouldPass, message) => {
  const result = spawnSync(process.execPath, [validator, file, "deployment"], { encoding: "utf8" });
  if ((result.status === 0) !== shouldPass) throw new Error(`${message}: ${result.stderr || result.stdout}`);
};

try {
  write(example);
  validate(true, "valid resource-group parameters were rejected");
  for (const [name, mutate] of [
    ["placeholder name", (document) => { document.parameters.resourceGroupName.value = "REPLACE_GROUP"; }],
    ["wrong commit", (document) => { document.parameters.buildCommit.value = "f".repeat(40); }],
    ["non-candidate environment", (document) => { document.parameters.environmentName.value = "production"; }],
    ["invalid location", (document) => { document.parameters.location.value = "Central India"; }],
  ]) {
    const document = structuredClone(example);
    mutate(document);
    write(document);
    validate(false, `${name} was accepted`);
  }
  process.stdout.write("Azure resource-group parameter safety tests passed.\n");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [file, mode = "example"] = process.argv.slice(2);
if (!file || !new Set(["example", "deployment"]).has(mode)) {
  throw new Error("usage: validate-resource-group-parameters.mjs <parameters.json> <example|deployment>");
}

const parsed = JSON.parse(readFileSync(file, "utf8"));
const parameters = Object.fromEntries(Object.entries(parsed.parameters ?? {}).map(([name, entry]) => [name, entry.value]));
for (const name of ["resourceGroupName", "location", "buildCommit", "environmentName"]) {
  if (!(name in parameters)) throw new Error(`missing parameter ${name}`);
}

const serialized = JSON.stringify(parameters);
if (/(private.?key|secret.?key|passphrase|database.?url)"\s*:/i.test(serialized)) {
  throw new Error("resource-group parameters must never contain secret/database/private-key fields");
}
if (mode === "example") {
  if (!serialized.includes("REPLACE_")) throw new Error("resource-group example must remain visibly non-deployable");
  if (parameters.environmentName !== "candidate") throw new Error("resource-group example must target candidate");
  process.stdout.write("Azure resource-group example is non-secret and intentionally non-deployable.\n");
  process.exit(0);
}

if (/REPLACE_|placeholder|example/i.test(serialized)) throw new Error("resource-group deployment parameters contain a placeholder");
if (!/^[A-Za-z0-9_().-]{1,90}$/.test(parameters.resourceGroupName) || parameters.resourceGroupName.endsWith(".")) {
  throw new Error("resourceGroupName is invalid");
}
if (!/^[a-z0-9-]{2,40}$/.test(parameters.location)) throw new Error("location must be an Azure region identifier");
if (parameters.environmentName !== "candidate") throw new Error("Phase 6/7 resource group must be isolated as candidate");
if (!/^[0-9a-f]{40}$/i.test(parameters.buildCommit)) throw new Error("buildCommit must be a full Git SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (parameters.buildCommit.toLowerCase() !== head.toLowerCase()) throw new Error("buildCommit must equal the checked-out immutable HEAD");
process.stdout.write("Azure resource-group deployment parameters passed fail-closed validation.\n");

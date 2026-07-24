import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [file, mode = "example"] = process.argv.slice(2);
if (!file || !new Set(["example", "deployment"]).has(mode)) {
  throw new Error("usage: validate-registry-parameters.mjs <parameters.json> <example|deployment>");
}

const parsed = JSON.parse(readFileSync(file, "utf8"));
const parameters = Object.fromEntries(Object.entries(parsed.parameters ?? {}).map(([name, entry]) => [name, entry.value]));
for (const name of ["registryName", "location", "buildCommit"]) {
  if (!(name in parameters)) throw new Error(`missing parameter ${name}`);
}
if (mode === "example") {
  if (!String(parameters.registryName).startsWith("REPLACE_")) throw new Error("registry example must remain non-deployable");
  process.stdout.write("Azure registry example is intentionally non-deployable.\n");
  process.exit(0);
}

if (!/^[a-z0-9]{5,50}$/.test(parameters.registryName)) throw new Error("registryName must be 5-50 lowercase alphanumeric characters");
if (parameters.location !== "centralindia") throw new Error("Phase 7 registry location must be the approved centralindia region");
if (!/^[0-9a-f]{40}$/i.test(parameters.buildCommit)) throw new Error("buildCommit must be a full Git SHA");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (parameters.buildCommit.toLowerCase() !== head.toLowerCase()) throw new Error("buildCommit must equal the checked-out immutable HEAD");
process.stdout.write("Azure Basic ACR parameters passed fail-closed validation.\n");

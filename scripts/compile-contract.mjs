import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = path.resolve(import.meta.dirname, "..");
const registrySourceName = "contracts/src/LaunchProofRegistry.sol";
const deploySourceName = "contracts/script/Deploy.s.sol";
const input = {
  language: "Solidity",
  sources: {
    [registrySourceName]: { content: fs.readFileSync(path.join(root, registrySourceName), "utf8") },
    [deploySourceName]: { content: fs.readFileSync(path.join(root, deploySourceName), "utf8") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const failures = (output.errors ?? []).filter((item) => item.severity === "error");
if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure.formattedMessage}\n`);
  process.exit(1);
}
const artifact = output.contracts[registrySourceName].LaunchProofRegistry;
if (!output.contracts[deploySourceName]?.Deploy?.evm?.bytecode?.object) throw new Error("Deploy.s.sol did not compile");
const outDir = path.join(root, "contracts", "out-solc");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "LaunchProofRegistry.bin"), `${artifact.evm.bytecode.object}\n`);
fs.writeFileSync(path.join(root, "schema", "registry.abi.json"), `${JSON.stringify(artifact.abi, null, 2)}\n`);
process.stdout.write(`Compiled LaunchProofRegistry (${artifact.evm.bytecode.object.length / 2} bytes), validated Deploy.s.sol, and refreshed schema/registry.abi.json\n`);

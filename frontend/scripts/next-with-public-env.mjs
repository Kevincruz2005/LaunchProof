import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const rootEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const childEnv = { ...process.env };

try {
  const values = parseEnv(await readFile(rootEnvPath, "utf8"));
  for (const [name, value] of Object.entries(values)) {
    if (name.startsWith("NEXT_PUBLIC_")) childEnv[name] = value;
    else delete childEnv[name];
  }
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  env: childEnv,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const azureDirectory = resolve(process.argv[2] ?? "infra/azure");
const directory = mkdtempSync(join(tmpdir(), "launchproof-health-"));
const key = join(directory, "key.pem");
const certificate = join(directory, "certificate.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
  "-keyout", key, "-out", certificate,
], { stdio: "ignore" });

const variants = ["healthy", "invalid-output", "schema-drift", "timeout"];
const servers = [];
try {
  const origins = [];
  for (const [index, variant] of variants.entries()) {
    const server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/healthz") {
        response.end(JSON.stringify({ status: "ok", fixture: true, variant, network: "eip155:1952", x402: index === 0 }));
        return;
      }
      if (request.url === "/.well-known/launch-contract.json") {
        response.end(JSON.stringify({ contract_version: "1.0", fixture: variant, source_revision: "a".repeat(40) }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    servers.push(server);
    const address = server.address();
    origins.push(`https://localhost:${address.port}`);
  }

  const child = spawn(resolve(azureDirectory, "scripts/health-acceptance.sh"), [], {
    env: {
      ...process.env,
      CURL_CA_BUNDLE: certificate,
      HEALTHY_ORIGIN: origins[0],
      INVALID_OUTPUT_ORIGIN: origins[1],
      SCHEMA_DRIFT_ORIGIN: origins[2],
      TIMEOUT_ORIGIN: origins[3],
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((resolveExit) => child.on("close", resolveExit));
  if (status !== 0) throw new Error(`health acceptance failed: ${stderr || stdout}`);
  if (!stdout.includes("No payment or rehearsal was executed")) throw new Error("health acceptance omitted its read-only safety result");
  process.stdout.write("Azure read-only health acceptance test passed against four isolated TLS fixtures.\n");
} finally {
  await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  rmSync(directory, { recursive: true, force: true });
}

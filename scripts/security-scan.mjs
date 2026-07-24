import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";

const TEXT_EXTENSIONS = new Set([".env", ".js", ".json", ".jsx", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml"]);
const SKIPPED_SEGMENTS = ["/node_modules/", "/dist/", "/.next/", "/coverage/"];

const contentRules = [
  ["private-key-literal", /0x[0-9a-fA-F]{64}/],
  ["private-key-pem", /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["openai-token", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["credentialed-database-url", /\bpostgres(?:ql)?:\/\/[^\s/:${}]+:[^\s@${}]+@/i],
];

export function scanText(text) {
  return contentRules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function isTestOnly(path) {
  return /(?:^|\/)(?:test|tests)(?:\/|$)/.test(path) || /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path);
}

function shouldScan(path) {
  if (SKIPPED_SEGMENTS.some((segment) => `/${path}`.includes(segment))) return false;
  if (path === ".env.example") return false;
  if (/^\.env(?:\..+)?$/.test(path)) return true;
  return TEXT_EXTENSIONS.has(extname(path)) || path.endsWith("Dockerfile");
}

function repositoryFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function scanRepository() {
  const findings = [];
  for (const path of repositoryFiles()) {
    if (/^\.env(?:\..+)?$/.test(path) && path !== ".env.example") {
      findings.push({ path, rule: "tracked-or-unignored-env-file" });
      continue;
    }
    if (!shouldScan(path) || isTestOnly(path)) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const rule of scanText(text)) findings.push({ path, rule });
  }
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`security-scan: ${finding.path}: ${finding.rule}\n`);
    throw new Error(`Security scan refused ${findings.length} potential secret occurrence(s); values were not printed`);
  }
  process.stdout.write("Security scan passed: no high-confidence secrets found in repository source/configuration files.\n");
}

function selfTest() {
  const syntheticPrivateKey = `0x${"12".repeat(32)}`;
  const syntheticDatabaseUrl = `${"postgresql"}://${"service"}:${"synthetic-password"}@${"database.invalid"}/app`;
  if (!scanText(`KEY=${syntheticPrivateKey}`).includes("private-key-literal")) throw new Error("Secret scanner failed its private-key self-test");
  if (!scanText(syntheticDatabaseUrl).includes("credentialed-database-url")) throw new Error("Secret scanner failed its database-credential self-test");
  if (scanText("XLAYER_CHAIN_ID=1952\nAPI_KEY=\n").length !== 0) throw new Error("Secret scanner rejected safe configuration");
  process.stdout.write("Security scan self-test passed.\n");
}

if (process.argv.includes("--self-test")) selfTest();
else scanRepository();

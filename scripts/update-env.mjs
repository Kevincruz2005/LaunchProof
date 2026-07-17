import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [fileName, ...pairs] = process.argv.slice(2);
if (!fileName || pairs.length === 0 || pairs.length % 2 !== 0) {
  throw new Error("usage: node scripts/update-env.mjs FILE KEY VALUE [KEY VALUE ...]");
}

const file = resolve(fileName);
if (!existsSync(file)) throw new Error(`${file} does not exist; copy .env.example first`);

const updates = new Map();
for (let index = 0; index < pairs.length; index += 2) {
  const key = pairs[index];
  const value = pairs[index + 1];
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`invalid environment key: ${key}`);
  if (/\r|\n/.test(value)) throw new Error(`environment value for ${key} must be a single line`);
  updates.set(key, value);
}

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const seen = new Set();
const next = lines.map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (!match || !updates.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${updates.get(match[1])}`;
});
for (const [key, value] of updates) {
  if (!seen.has(key)) next.push(`${key}=${value}`);
}

writeFileSync(file, `${next.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
chmodSync(file, 0o600);


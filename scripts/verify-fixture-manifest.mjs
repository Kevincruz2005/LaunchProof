import { createRequire } from "node:module";
import { LaunchContractSchema, manifestSigningBody } from "../backend/dist/launch-contract/schema.js";
import { hashJcs } from "../backend/dist/evidence/canonical.js";

const url = process.argv[2];
if (!url) throw new Error("usage: node scripts/verify-fixture-manifest.mjs URL");
const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const { verifyMessage } = requireFromBackend("viem");
const response = await fetch(url);
if (!response.ok) throw new Error(`Fixture manifest returned HTTP ${response.status}`);
const manifest = LaunchContractSchema.parse(await response.json());
if (!manifest.fixture || !manifest.declaration_signature) throw new Error("Fixture manifest is not labeled and signed");
const manifestHash = hashJcs(manifestSigningBody(manifest));
const valid = await verifyMessage({
  address: manifest.provider_address,
  message: { raw: manifestHash },
  signature: manifest.declaration_signature,
});
if (!valid) throw new Error("Fixture declaration signature is invalid");
process.stdout.write(`${JSON.stringify({ fixture: true, service_name: manifest.service_name, manifest_hash: manifestHash, declaration_valid: true })}\n`);

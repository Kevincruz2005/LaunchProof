import { spawnSync } from "node:child_process";

// These non-secret, test-only anchors exercise production build validation.
// The generated bundle is a local test artifact and must never be deployed.
const validationEnvironment = {
  ...process.env,
  NEXT_PUBLIC_API_BASE_URL: "https://api.ci.launchproof.dev",
  NEXT_PUBLIC_WEB_BASE_URL: "https://ci.launchproof.dev",
  NEXT_PUBLIC_XLAYER_RPC_URL: "https://testrpc.xlayer.tech/terigon",
  NEXT_PUBLIC_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_PAYOUT_ADDRESS: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_CHAIN_ID: "1952",
  NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK: "1",
  NEXT_PUBLIC_SOURCE_REPOSITORY: "https://github.com/tests/launchproof",
};

const result = spawnSync("pnpm", ["-r", "--if-present", "build"], {
  env: validationEnvironment,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

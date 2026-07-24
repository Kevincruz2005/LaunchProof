import { readFileSync } from "node:fs";
import { join } from "node:path";

const [compiledFile, azureDirectory] = process.argv.slice(2);
if (!compiledFile || !azureDirectory) throw new Error("usage: inspect-template.mjs <compiled-template.json> <azure-directory>");
const template = JSON.parse(readFileSync(compiledFile, "utf8"));
const mainSource = readFileSync(join(azureDirectory, "bicep/main.bicep"), "utf8");
const appSource = readFileSync(join(azureDirectory, "bicep/modules/container-app.bicep"), "utf8");

function resources(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value.resources)) {
    for (const resource of value.resources) {
      if (typeof resource.type === "string") result.push(resource);
      resources(resource, result);
    }
  }
  for (const [name, child] of Object.entries(value)) {
    if (name !== "resources") resources(child, result);
  }
  return result;
}

const all = resources(template);
const count = (type) => all.filter((resource) => resource.type.toLowerCase() === type.toLowerCase()).length;
const requireSource = (pattern, message) => {
  if (!pattern.test(`${mainSource}\n${appSource}`)) throw new Error(message);
};

if (count("Microsoft.App/managedEnvironments") !== 1) throw new Error("exactly one Container Apps environment must be modeled");
if (count("Microsoft.ManagedIdentity/userAssignedIdentities") !== 1) throw new Error("exactly one managed identity must be modeled");
if (count("Microsoft.KeyVault/vaults") !== 1) throw new Error("exactly one Key Vault must be modeled");
if (count("Microsoft.OperationalInsights/workspaces") !== 1) throw new Error("exactly one capped Log Analytics workspace must be modeled");
if (count("Microsoft.ContainerRegistry/registries") !== 0) throw new Error("the plan must never create ACR");
if (count("Microsoft.DBforPostgreSQL/flexibleServers") !== 0) throw new Error("Supabase must not be migrated in Phase 6");

requireSource(/activeRevisionsMode:\s*'Single'/, "Container Apps must use single active revision mode");
requireSource(/minReplicas:\s*minReplicas[\s\S]*maxReplicas:\s*maxReplicas/, "replica limits are missing");
requireSource(/@minValue\(1\)[\s\S]*@maxValue\(1\)[\s\S]*param minReplicas/, "minReplicas must be fixed at one");
requireSource(/@minValue\(1\)[\s\S]*@maxValue\(1\)[\s\S]*param maxReplicas/, "maxReplicas must be fixed at one");
for (const probe of ["Startup", "Readiness", "Liveness"]) requireSource(new RegExp(`type:\\s*'${probe}'`), `${probe} probe is missing`);
requireSource(/external:\s*true/, "external HTTPS ingress is missing");
requireSource(/allowInsecure:\s*false/, "HTTP ingress must not be allowed");
requireSource(/var writerSafety = !backendEnabled[\s\S]*writerCutoverApproved[\s\S]*fail\('Active backend requires/, "writer cutover fail-closed gate is missing");
requireSource(/var backendEnabled = activationMode == 'active'/, "candidate mode must omit the backend");
requireSource(/PUBLIC_ALLOWED_ORIGINS', value: vercelWebOrigin/, "exact Vercel CORS origin is missing");
if (/PUBLIC_ALLOWED_ORIGINS[^\n]*\*/.test(mainSource)) throw new Error("wildcard CORS is forbidden");
requireSource(/LEADERSHIP_DATABASE_MODE', value: 'session'/, "Phase 5 session leadership mode is missing");
requireSource(/BACKEND_REPLICA_COUNT', value: '1'/, "backend replica safety declaration is missing");
requireSource(/X402_ENABLED', value: 'true'/, "paid healthy/backend mode is missing");
requireSource(/fixture-healthy-provider-private-key/, "healthy stable Key Vault identity is missing");
requireSource(/fixture-invalid-output-provider-private-key/, "invalid-output stable Key Vault identity is missing");
requireSource(/fixture-schema-drift-provider-private-key/, "schema-drift stable Key Vault identity is missing");
requireSource(/fixture-timeout-provider-private-key/, "timeout stable Key Vault identity is missing");
requireSource(/retentionInDays:\s*30/, "log retention must be capped at 30 days");
requireSource(/dailyQuotaGb:\s*1/, "log ingestion must have a daily cap");
requireSource(/@sha256:/, "immutable image digest assertions are missing");
requireSource(/resource budget 'Microsoft\.Consumption\/budgets/, "optional cost budget is missing");
requireSource(/module healthyFixture[\s\S]*targetPort:\s*4100/, "healthy fixture is missing or has the wrong port");
requireSource(/module invalidOutputFixture[\s\S]*targetPort:\s*4101/, "invalid fixture is missing or has the wrong port");
requireSource(/module schemaDriftFixture[\s\S]*targetPort:\s*4102/, "schema-drift fixture is missing or has the wrong port");
requireSource(/module timeoutFixture[\s\S]*targetPort:\s*4103/, "timeout fixture is missing or has the wrong port");

const forbiddenSecretValue = all.some((resource) => {
  const secrets = resource?.properties?.configuration?.secrets;
  return Array.isArray(secrets) && secrets.some((secret) => Object.hasOwn(secret, "value"));
});
if (forbiddenSecretValue) throw new Error("Container App secret values must never be embedded");

const typeCounts = [...new Set(all.map((resource) => resource.type))]
  .sort()
  .map((type) => ({ type, count: count(type) }));
process.stdout.write(`${JSON.stringify({ validation: "passed", resources: typeCounts }, null, 2)}\n`);

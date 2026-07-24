targetScope = 'resourceGroup'

@description('Azure region chosen only after subscription review.')
param location string = resourceGroup().location

@minLength(3)
@maxLength(15)
@description('Lowercase prefix used for candidate resource names.')
param namePrefix string

@allowed([
  'read-only'
  'active'
])
@description('read-only deploys a backend with no writer/payment capability; active requires a separately approved stop-old cutover.')
param activationMode string = 'read-only'

@description('Must remain false until Phase 7 approval and proof that the old writer is disabled.')
param writerCutoverApproved bool = false

@description('Whether to model/deploy the four fixture workloads. Secrets must already exist in Key Vault.')
param deployWorkloads bool = true

@description('Whether to deploy the backend. Phase 7 permits this only in read-only mode.')
param deployBackend bool = true

@minLength(40)
@maxLength(40)
@description('Immutable full Git commit for tags, image tags, and application provenance.')
param buildCommit string

@description('Existing public GitHub source repository URL.')
param sourceRepositoryUrl string

@description('Existing Vercel frontend HTTPS origin; this template never creates or moves it.')
param vercelWebOrigin string

@description('Subscription containing the existing Azure Container Registry.')
param containerRegistrySubscriptionId string

@description('Resource group containing the existing Azure Container Registry.')
param containerRegistryResourceGroup string

@description('Name of the existing Azure Container Registry. No ACR is created by this template.')
param containerRegistryName string

@description('Login server of the existing registry, cross-checked by validation scripts.')
param containerRegistryServer string

@description('Immutable backend image reference ending in @sha256:digest.')
param backendImage string

@description('Immutable healthy fixture image reference ending in @sha256:digest.')
param healthyFixtureImage string

@description('Immutable invalid-output fixture image reference ending in @sha256:digest.')
param invalidOutputFixtureImage string

@description('Immutable schema-drift fixture image reference ending in @sha256:digest.')
param schemaDriftFixtureImage string

@description('Immutable timeout fixture image reference ending in @sha256:digest.')
param timeoutFixtureImage string

@description('X Layer testnet primary RPC URL. Must be public HTTPS and report chain 1952.')
param xlayerRpcUrl string

@description('Independent X Layer testnet fallback RPC URL.')
param xlayerFallbackRpcUrl string

@description('X Layer testnet explorer base URL.')
param xlayerExplorerUrl string

@description('Official X Layer testnet USD₮0 asset address, validated before deployment.')
param xlayerUsdt0Address string

@description('Existing immutable LaunchProof registry on X Layer testnet.')
param registryAddress string

@description('Existing registry creation block.')
param registryDeploymentBlock string

@description('Expected keccak256 runtime bytecode hash for the existing registry.')
param registryRuntimeCodeHash string

@description('Existing LaunchProof x402 payout address. This is public, not a private key.')
param payoutAddress string

@description('Existing paid healthy-fixture recipient. This is public, not a private key.')
param fixturePaymentRecipient string

@description('Provider declaration address corresponding to the healthy fixture Key Vault key.')
param healthyProviderAddress string

@description('Provider declaration address corresponding to the invalid-output fixture Key Vault key.')
param invalidOutputProviderAddress string

@description('Provider declaration address corresponding to the schema-drift fixture Key Vault key.')
param schemaDriftProviderAddress string

@description('Provider declaration address corresponding to the timeout fixture Key Vault key.')
param timeoutProviderAddress string

@description('Official OKX Web3 facilitator origin; validated as an exact origin by the application.')
param okxBaseUrl string

@minValue(1)
@maxValue(100000)
@description('Healthy fixture delivery price in atomic test USD₮0 units.')
param fixturePaymentAmountAtomic int = 10000

@description('Maximum provider payment per run in test USD₮0.')
param targetPaymentMaxUsdt0 string = '0.10'

@description('Maximum provider payments per day in test USD₮0.')
param targetPaymentDailyLimitUsdt0 string = '1.00'

@minValue(1)
@maxValue(1000)
param freeRateLimitPerMinute int = 60

@minValue(1)
@maxValue(100)
param paidRateLimitPerHour int = 6

@minValue(1)
@maxValue(1000)
param globalRunLimitPerDay int = 100

@minValue(1)
@maxValue(10)
param maxConcurrentRuns int = 3

@description('Enable an Azure Cost Management budget only when the selected subscription supports it.')
param enableBudget bool = false

@minValue(1)
@description('Monthly budget amount in the subscription billing currency. Budgets alert; they do not stop resources.')
param monthlyBudgetAmount int = 10

@description('First day of a month, supplied for the non-applying plan and later approved deployment.')
param budgetStartDate string

@description('Budget end date after the start date.')
param budgetEndDate string

@description('Budget notification recipients. Required only when enableBudget=true.')
param budgetContactEmails array = []

var readOnlyMode = activationMode == 'read-only'
var backendSafety = !deployBackend || deployWorkloads ? 'backend-dependencies-validated' : fail('Backend deployment requires all four fixture workloads')
var writerSafety = readOnlyMode
  ? !writerCutoverApproved ? 'read-only-no-writer' : fail('Read-only mode requires writerCutoverApproved=false')
  : writerCutoverApproved && deployWorkloads && deployBackend ? 'active-cutover-approved' : fail('Active backend requires writerCutoverApproved=true, deployWorkloads=true, and deployBackend=true')
var registrySafety = containerRegistryServer == '${containerRegistryName}.azurecr.io' ? 'existing-acr-validated' : fail('Container registry server/name mismatch')
var imageTagAndDigest = ':${toLower(buildCommit)}@sha256:'
var imageSafety = startsWith(toLower(backendImage), '${toLower(containerRegistryServer)}/') && contains(toLower(backendImage), imageTagAndDigest) && startsWith(toLower(healthyFixtureImage), '${toLower(containerRegistryServer)}/') && contains(toLower(healthyFixtureImage), imageTagAndDigest) && startsWith(toLower(invalidOutputFixtureImage), '${toLower(containerRegistryServer)}/') && contains(toLower(invalidOutputFixtureImage), imageTagAndDigest) && startsWith(toLower(schemaDriftFixtureImage), '${toLower(containerRegistryServer)}/') && contains(toLower(schemaDriftFixtureImage), imageTagAndDigest) && startsWith(toLower(timeoutFixtureImage), '${toLower(containerRegistryServer)}/') && contains(toLower(timeoutFixtureImage), imageTagAndDigest) ? 'commit-tags-and-digests-validated' : fail('Every image must use the approved existing ACR, the exact build commit tag, and an immutable sha256 digest')
var zeroAddress = '0x0000000000000000000000000000000000000000'
var productionRoleAddresses = map([registryAddress, payoutAddress, healthyProviderAddress, invalidOutputProviderAddress, schemaDriftProviderAddress, timeoutProviderAddress], address => toLower(address))
var roleSafety = !contains(productionRoleAddresses, zeroAddress) && length(union(productionRoleAddresses, [])) == length(productionRoleAddresses) ? 'distinct-roles-validated' : fail('Registry, payout, and controlled fixture declaration addresses must be nonzero and distinct')
var fixtureRecipientSafety = toLower(fixturePaymentRecipient) != zeroAddress ? 'fixture-recipient-validated' : fail('Fixture payment recipient must be nonzero')
var paymentMaxNumeric = json(targetPaymentMaxUsdt0)
var paymentDailyNumeric = json(targetPaymentDailyLimitUsdt0)
var paymentSafety = paymentMaxNumeric > 0 && paymentMaxNumeric <= 10 && paymentDailyNumeric >= paymentMaxNumeric && paymentDailyNumeric <= 100 ? 'payment-caps-validated' : fail('Payment caps must be positive, daily >= per-run, per-run <= 10, and daily <= 100 test USDt0')
var budgetSafety = !enableBudget || length(budgetContactEmails) > 0 ? 'budget-validated' : fail('Enabled budget requires at least one contact email')
var tags = {
  project: 'launchproof'
  environment: activationMode
  commit: buildCommit
  managedBy: 'bicep'
  phase: 'phase-7-read-only-candidate'
  backendSafety: backendSafety
  writerSafety: writerSafety
  registrySafety: registrySafety
  imageSafety: imageSafety
  roleSafety: roleSafety
  fixtureRecipientSafety: fixtureRecipientSafety
  paymentSafety: paymentSafety
  budgetSafety: budgetSafety
}
var suffix = take(uniqueString(subscription().subscriptionId, resourceGroup().id), 8)
var identityName = '${namePrefix}-identity'
var keyVaultName = take('${namePrefix}-${suffix}-kv', 24)
var logWorkspaceName = take('${namePrefix}-${suffix}-logs', 63)
var containerEnvironmentName = take('${namePrefix}-${suffix}-cae', 32)
var backendName = take('${namePrefix}-backend', 32)
var healthyName = take('${namePrefix}-fixture-healthy', 32)
var invalidOutputName = take('${namePrefix}-fixture-invalid', 32)
var schemaDriftName = take('${namePrefix}-fixture-drift', 32)
var timeoutName = take('${namePrefix}-fixture-timeout', 32)

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: location
  tags: tags
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: logWorkspaceName
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    features: {
      disableLocalAuth: false
      enableLogAccessUsingOnlyResourcePermissions: true
      immediatePurgeDataOn30Days: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    sku: {
      name: 'PerGB2018'
    }
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: containerEnvironmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
    peerTrafficConfiguration: {
      encryption: {
        enabled: true
      }
    }
    publicNetworkAccess: 'Enabled'
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

module acrAccess 'modules/acr-pull.bicep' = if (deployWorkloads) {
  name: 'existing-acr-pull-${take(buildCommit, 10)}'
  scope: resourceGroup(containerRegistrySubscriptionId, containerRegistryResourceGroup)
  params: {
    registryName: containerRegistryName
    principalId: identity.properties.principalId
  }
}

var defaultDomain = containerEnvironment.properties.defaultDomain
var backendOrigin = 'https://${backendName}.${defaultDomain}'
var healthyOrigin = 'https://${healthyName}.${defaultDomain}'
var invalidOutputOrigin = 'https://${invalidOutputName}.${defaultDomain}'
var schemaDriftOrigin = 'https://${schemaDriftName}.${defaultDomain}'
var timeoutOrigin = 'https://${timeoutName}.${defaultDomain}'
var targetAllowlist = join([
  '${healthyName}.${defaultDomain}'
  '${invalidOutputName}.${defaultDomain}'
  '${schemaDriftName}.${defaultDomain}'
  '${timeoutName}.${defaultDomain}'
], ',')

var backendReadOnlySecrets = [
  {
    name: 'database-url'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/backend-readonly-database-url'
    identity: identity.id
  }
]

var backendWriterSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/backend-database-url'
    identity: identity.id
  }
  {
    name: 'leadership-db-url'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/backend-leadership-database-url'
    identity: identity.id
  }
  {
    name: 'registry-writer-key'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/registry-writer-private-key'
    identity: identity.id
  }
  {
    name: 'target-payer-key'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/target-payer-private-key'
    identity: identity.id
  }
  {
    name: 'okx-api-key'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-api-key'
    identity: identity.id
  }
  {
    name: 'okx-secret-key'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-secret-key'
    identity: identity.id
  }
  {
    name: 'okx-passphrase'
    keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-passphrase'
    identity: identity.id
  }
]

var backendCommonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'BACKEND_MODE', value: readOnlyMode ? 'read-only' : 'writer' }
  { name: 'PORT', value: '4000' }
  { name: 'PUBLIC_API_BASE_URL', value: backendOrigin }
  { name: 'PUBLIC_WEB_BASE_URL', value: vercelWebOrigin }
  { name: 'PUBLIC_ALLOWED_ORIGINS', value: vercelWebOrigin }
  { name: 'BUILD_COMMIT_SHA', value: buildCommit }
  { name: 'RELEASE_IMAGE_TAG', value: buildCommit }
  { name: 'RELEASE_IMAGE_DIGEST', value: last(split(backendImage, '@')) }
  { name: 'SOURCE_REPOSITORY', value: sourceRepositoryUrl }
  { name: 'XLAYER_TESTNET', value: 'true' }
  { name: 'XLAYER_CHAIN_ID', value: '1952' }
  { name: 'XLAYER_NETWORK', value: 'eip155:1952' }
  { name: 'XLAYER_USDT0_ADDRESS', value: xlayerUsdt0Address }
  { name: 'XLAYER_EXPLORER_URL', value: xlayerExplorerUrl }
  { name: 'XLAYER_RPC_URL', value: xlayerRpcUrl }
  { name: 'XLAYER_FALLBACK_RPC_URL', value: xlayerFallbackRpcUrl }
  { name: 'REGISTRY_ADDRESS', value: registryAddress }
  { name: 'REGISTRY_DEPLOYMENT_BLOCK', value: registryDeploymentBlock }
  { name: 'REGISTRY_RUNTIME_CODE_HASH', value: registryRuntimeCodeHash }
  { name: 'PAYOUT_ADDRESS', value: payoutAddress }
  { name: 'OKX_BASE_URL', value: okxBaseUrl }
  { name: 'TARGET_PAYMENT_MAX_USDT0', value: targetPaymentMaxUsdt0 }
  { name: 'TARGET_PAYMENT_DAILY_LIMIT_USDT0', value: targetPaymentDailyLimitUsdt0 }
  { name: 'TARGET_ALLOWLIST', value: targetAllowlist }
  { name: 'MAX_CONCURRENT_RUNS', value: string(maxConcurrentRuns) }
  { name: 'FREE_RATE_LIMIT_PER_MINUTE', value: string(freeRateLimitPerMinute) }
  { name: 'PAID_RATE_LIMIT_PER_HOUR', value: string(paidRateLimitPerHour) }
  { name: 'GLOBAL_RUN_LIMIT_PER_DAY', value: string(globalRunLimitPerDay) }
  { name: 'BACKEND_REPLICA_COUNT', value: '1' }
  { name: 'ALLOW_LOCAL_UNPAID_RUNS', value: 'false' }
  { name: 'ALLOW_PRIVATE_TARGETS', value: 'false' }
  { name: 'PASSPORT_GATE_WARN_AGE_HOURS', value: '24' }
  { name: 'PASSPORT_GATE_MAX_AGE_HOURS', value: '168' }
  { name: 'FIXTURE_HEALTHY_URL', value: healthyOrigin }
  { name: 'FIXTURE_INVALID_OUTPUT_URL', value: invalidOutputOrigin }
  { name: 'FIXTURE_SCHEMA_DRIFT_URL', value: schemaDriftOrigin }
  { name: 'FIXTURE_TIMEOUT_URL', value: timeoutOrigin }
  { name: 'FIXTURE_HEALTHY_PROVIDER_ADDRESS', value: healthyProviderAddress }
  { name: 'FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS', value: invalidOutputProviderAddress }
  { name: 'FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS', value: schemaDriftProviderAddress }
  { name: 'FIXTURE_TIMEOUT_PROVIDER_ADDRESS', value: timeoutProviderAddress }
]

var backendReadOnlyEnv = [
  { name: 'X402_ENABLED', value: 'false' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
]

var backendWriterEnv = [
  { name: 'REGISTRY_WRITER_PRIVATE_KEY', secretRef: 'registry-writer-key' }
  { name: 'TARGET_PAYER_PRIVATE_KEY', secretRef: 'target-payer-key' }
  { name: 'OKX_API_KEY', secretRef: 'okx-api-key' }
  { name: 'OKX_SECRET_KEY', secretRef: 'okx-secret-key' }
  { name: 'OKX_PASSPHRASE', secretRef: 'okx-passphrase' }
  { name: 'X402_ENABLED', value: 'true' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'LEADERSHIP_DATABASE_URL', secretRef: 'leadership-db-url' }
  { name: 'LEADERSHIP_DATABASE_MODE', value: 'session' }
]

var backendEnv = concat(backendCommonEnv, readOnlyMode ? backendReadOnlyEnv : backendWriterEnv)
var backendSecrets = readOnlyMode ? backendReadOnlySecrets : backendWriterSecrets

var fixtureBaseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'FIXTURE_BIND_HOST', value: '0.0.0.0' }
  { name: 'SOURCE_REVISION', value: buildCommit }
  { name: 'RELEASE_IMAGE_TAG', value: buildCommit }
  { name: 'FIXTURE_PROVIDER_KEY_SOURCE', value: 'external-secret' }
  { name: 'XLAYER_TESTNET', value: 'true' }
  { name: 'XLAYER_CHAIN_ID', value: '1952' }
  { name: 'XLAYER_NETWORK', value: 'eip155:1952' }
  { name: 'XLAYER_USDT0_ADDRESS', value: xlayerUsdt0Address }
  { name: 'PAYMENT_RECIPIENT', value: fixturePaymentRecipient }
  { name: 'PAYMENT_AMOUNT_ATOMIC', value: string(fixturePaymentAmountAtomic) }
  { name: 'OKX_BASE_URL', value: okxBaseUrl }
]

module healthyFixture 'modules/container-app.bicep' = if (deployWorkloads) {
  name: 'fixture-healthy-${take(buildCommit, 10)}'
  params: {
    name: healthyName
    location: location
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    identityId: identity.id
    registryServer: containerRegistryServer
    image: healthyFixtureImage
    buildCommit: buildCommit
    targetPort: 4100
    cpu: '0.25'
    memory: '0.5Gi'
    env: concat(fixtureBaseEnv, [
      { name: 'PORT', value: '4100' }
      { name: 'PUBLIC_BASE_URL', value: healthyOrigin }
      { name: 'RELEASE_IMAGE_DIGEST', value: last(split(healthyFixtureImage, '@')) }
      { name: 'FIXTURE_PROVIDER_PRIVATE_KEY', secretRef: 'provider-key' }
      { name: 'X402_ENABLED', value: 'true' }
      { name: 'OKX_API_KEY', secretRef: 'okx-api-key' }
      { name: 'OKX_SECRET_KEY', secretRef: 'okx-secret-key' }
      { name: 'OKX_PASSPHRASE', secretRef: 'okx-passphrase' }
    ])
    secrets: concat([
      {
        name: 'provider-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/fixture-healthy-provider-private-key'
        identity: identity.id
      }
    ], [
      {
        name: 'okx-api-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-api-key'
        identity: identity.id
      }
      {
        name: 'okx-secret-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-secret-key'
        identity: identity.id
      }
      {
        name: 'okx-passphrase'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/okx-passphrase'
        identity: identity.id
      }
    ])
  }
  dependsOn: [
    keyVaultSecretsUser
    acrAccess
  ]
}

module invalidOutputFixture 'modules/container-app.bicep' = if (deployWorkloads) {
  name: 'fixture-invalid-${take(buildCommit, 10)}'
  params: {
    name: invalidOutputName
    location: location
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    identityId: identity.id
    registryServer: containerRegistryServer
    image: invalidOutputFixtureImage
    buildCommit: buildCommit
    targetPort: 4101
    cpu: '0.25'
    memory: '0.5Gi'
    env: concat(fixtureBaseEnv, [
      { name: 'PORT', value: '4101' }
      { name: 'PUBLIC_BASE_URL', value: invalidOutputOrigin }
      { name: 'RELEASE_IMAGE_DIGEST', value: last(split(invalidOutputFixtureImage, '@')) }
      { name: 'FIXTURE_PROVIDER_PRIVATE_KEY', secretRef: 'provider-key' }
      { name: 'X402_ENABLED', value: 'false' }
    ])
    secrets: [
      {
        name: 'provider-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/fixture-invalid-output-provider-private-key'
        identity: identity.id
      }
    ]
  }
  dependsOn: [keyVaultSecretsUser, acrAccess]
}

module schemaDriftFixture 'modules/container-app.bicep' = if (deployWorkloads) {
  name: 'fixture-drift-${take(buildCommit, 10)}'
  params: {
    name: schemaDriftName
    location: location
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    identityId: identity.id
    registryServer: containerRegistryServer
    image: schemaDriftFixtureImage
    buildCommit: buildCommit
    targetPort: 4102
    cpu: '0.25'
    memory: '0.5Gi'
    env: concat(fixtureBaseEnv, [
      { name: 'PORT', value: '4102' }
      { name: 'PUBLIC_BASE_URL', value: schemaDriftOrigin }
      { name: 'RELEASE_IMAGE_DIGEST', value: last(split(schemaDriftFixtureImage, '@')) }
      { name: 'FIXTURE_PROVIDER_PRIVATE_KEY', secretRef: 'provider-key' }
      { name: 'X402_ENABLED', value: 'false' }
    ])
    secrets: [
      {
        name: 'provider-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/fixture-schema-drift-provider-private-key'
        identity: identity.id
      }
    ]
  }
  dependsOn: [keyVaultSecretsUser, acrAccess]
}

module timeoutFixture 'modules/container-app.bicep' = if (deployWorkloads) {
  name: 'fixture-timeout-${take(buildCommit, 10)}'
  params: {
    name: timeoutName
    location: location
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    identityId: identity.id
    registryServer: containerRegistryServer
    image: timeoutFixtureImage
    buildCommit: buildCommit
    targetPort: 4103
    cpu: '0.25'
    memory: '0.5Gi'
    env: concat(fixtureBaseEnv, [
      { name: 'PORT', value: '4103' }
      { name: 'PUBLIC_BASE_URL', value: timeoutOrigin }
      { name: 'RELEASE_IMAGE_DIGEST', value: last(split(timeoutFixtureImage, '@')) }
      { name: 'FIXTURE_PROVIDER_PRIVATE_KEY', secretRef: 'provider-key' }
      { name: 'X402_ENABLED', value: 'false' }
    ])
    secrets: [
      {
        name: 'provider-key'
        keyVaultUrl: '${keyVault.properties.vaultUri}secrets/fixture-timeout-provider-private-key'
        identity: identity.id
      }
    ]
  }
  dependsOn: [keyVaultSecretsUser, acrAccess]
}

module backend 'modules/container-app.bicep' = if (deployBackend) {
  name: 'backend-${take(buildCommit, 10)}'
  params: {
    name: backendName
    location: location
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    identityId: identity.id
    registryServer: containerRegistryServer
    image: backendImage
    buildCommit: buildCommit
    targetPort: 4000
    cpu: '0.5'
    memory: '1.0Gi'
    env: backendEnv
    secrets: backendSecrets
  }
  dependsOn: [
    keyVaultSecretsUser
    acrAccess
    healthyFixture
    invalidOutputFixture
    schemaDriftFixture
    timeoutFixture
  ]
}

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = if (enableBudget) {
  name: '${namePrefix}-monthly-budget'
  properties: {
    amount: monthlyBudgetAmount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
      endDate: budgetEndDate
    }
    notifications: {
      actual80Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
      actual100Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
        contactGroups: []
        contactRoles: []
        locale: 'en-us'
      }
    }
  }
}

output activationMode string = activationMode
output backendDeployed bool = deployBackend
output backendOrigin string = deployBackend ? backendOrigin : ''
output fixtureOrigins array = deployWorkloads ? [healthyOrigin, invalidOutputOrigin, schemaDriftOrigin, timeoutOrigin] : []
output keyVaultName string = keyVault.name
output managedEnvironmentName string = containerEnvironment.name
output managedIdentityId string = identity.id
output logWorkspaceName string = logWorkspace.name

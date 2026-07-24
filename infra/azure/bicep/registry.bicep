targetScope = 'resourceGroup'

@minLength(5)
@maxLength(50)
@description('Globally unique lowercase Azure Container Registry name approved separately for Phase 7.')
param registryName string

@description('Azure region reviewed for the isolated Phase 7 candidate.')
param location string = resourceGroup().location

@minLength(40)
@maxLength(40)
@description('Immutable LaunchProof source commit represented by images in this registry.')
param buildCommit string

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: registryName
  location: location
  tags: {
    project: 'launchproof'
    environment: 'phase7-read-only-candidate'
    commit: buildCommit
    managedBy: 'bicep'
    costTier: 'Basic'
  }
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: false
    networkRuleBypassOptions: 'AzureServices'
    publicNetworkAccess: 'Enabled'
    policies: {
      exportPolicy: {
        status: 'enabled'
      }
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'disabled'
      }
      trustPolicy: {
        status: 'disabled'
        type: 'Notary'
      }
    }
  }
}

output registryId string = registry.id
output registryName string = registry.name
output loginServer string = registry.properties.loginServer
output sku string = registry.sku.name
output adminUserEnabled bool = registry.properties.adminUserEnabled

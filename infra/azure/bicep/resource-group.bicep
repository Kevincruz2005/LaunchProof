targetScope = 'subscription'

@description('Dedicated candidate resource group; must not be a live Vercel/Railway/Supabase resource group.')
param resourceGroupName string

@description('Azure region selected after subscription review.')
param location string

@description('Immutable 40-character commit represented by this candidate.')
@minLength(40)
@maxLength(40)
param buildCommit string

@description('Candidate environment name, for example candidate or staging.')
param environmentName string = 'candidate'

resource candidateResourceGroup 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: {
    project: 'launchproof'
    environment: environmentName
    commit: buildCommit
    managedBy: 'bicep'
    phase: 'phase-6-iac'
  }
}

output resourceGroupId string = candidateResourceGroup.id
output resourceGroupName string = candidateResourceGroup.name

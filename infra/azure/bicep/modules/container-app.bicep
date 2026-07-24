@description('Container App resource name.')
param name string

@description('Azure region inherited from the managed environment.')
param location string

@description('Resource tags including project, environment, and immutable commit.')
param tags object

@description('Resource ID of the Container Apps managed environment.')
param managedEnvironmentId string

@description('Resource ID of the user-assigned identity used for Key Vault and ACR.')
param identityId string

@description('Existing container registry login server.')
param registryServer string

@description('Immutable image reference in registry/repository@sha256:digest form.')
param image string

@description('Immutable 40-character deployment commit used to make the revision suffix unique for this rollout.')
param revisionCommit string

@description('Container target port.')
param targetPort int

@description('Container CPU cores. Consumption supports 0.25/0.5Gi as the minimum pair.')
param cpu string

@description('Container memory allocation.')
param memory string

@description('Non-secret and secretRef environment entries.')
param env array

@description('Container App secrets backed only by Key Vault references.')
param secrets array

@minValue(1)
@maxValue(1)
@description('Kept at one to avoid latency/cold-start nondeterminism and writer overlap.')
param minReplicas int = 1

@minValue(1)
@maxValue(1)
@description('Exactly one replica; Phase 5 leadership remains the cross-revision fence.')
param maxReplicas int = 1

@description('HTTP health path used for startup and readiness probes.')
param healthPath string = '/healthz'

resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      ingress: {
        external: true
        allowInsecure: false
        targetPort: targetPort
        transport: 'http'
      }
      registries: [
        {
          server: registryServer
          identity: identityId
        }
      ]
      secrets: secrets
    }
    template: {
      revisionSuffix: '${toLower(substring(revisionCommit, 0, 10))}-${uniqueString(image, string(env), string(secrets), string(targetPort), cpu, memory)}'
      containers: [
        {
          name: name
          image: image
          env: env
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: healthPath
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 2
              periodSeconds: 3
              timeoutSeconds: 2
              failureThreshold: 40
              successThreshold: 1
            }
            {
              type: 'Readiness'
              httpGet: {
                path: healthPath
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 3
              periodSeconds: 5
              timeoutSeconds: 3
              failureThreshold: 12
              successThreshold: 1
            }
            {
              type: 'Liveness'
              tcpSocket: {
                port: targetPort
              }
              initialDelaySeconds: 15
              periodSeconds: 10
              timeoutSeconds: 2
              failureThreshold: 3
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output id string = app.id
output fqdn string = app.properties.configuration.ingress.fqdn
output latestRevisionName string = app.properties.latestRevisionName

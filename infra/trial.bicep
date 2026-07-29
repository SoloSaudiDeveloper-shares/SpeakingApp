targetScope = 'resourceGroup'

@description('Azure region used by the existing trial resources.')
param location string = 'uksouth'

@description('Prefix used by the application, jobs, and Container Apps environment.')
@minLength(3)
@maxLength(24)
param prefix string = 'speakinglab'

@description('Existing VNet containing the delegated Container Apps subnet.')
param virtualNetworkName string = 'speakinglab-vnet'

@description('Existing delegated subnet with Microsoft.Storage and Microsoft.KeyVault service endpoints.')
param containerAppsSubnetName string = 'container-apps'

@description('Existing user-assigned managed identity.')
param runtimeIdentityName string = 'speakinglab-runtime'

@description('Existing private Blob Storage account.')
param storageAccountName string = 'speakinglabst20260729'

@description('Existing RBAC-enabled Key Vault.')
param keyVaultName string = 'speakinglab-kv-20260729'

@description('Public, secret-free application image pinned to a Git commit SHA.')
param appImage string

@description('Public, secret-free jobs image pinned to the same Git commit SHA.')
param jobsImage string

@secure()
@description('External PostgreSQL connection string. For the free trial, use the Supabase London session pooler with TLS required.')
param databaseUrl string

@secure()
@minLength(16)
param bootstrapAdministratorPassword string

@secure()
@minLength(24)
param xapiJobToken string

var environmentName = '${prefix}-trial-env'
var appName = '${prefix}-app'
var audioContainerName = 'speaking-audio'
var backupContainerName = 'database-backups'

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' existing = {
  name: virtualNetworkName
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: network
  name: containerAppsSubnetName
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: runtimeIdentityName
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: storageAccountName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: databaseUrl
  }
}

resource bootstrapSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'bootstrap-admin-password'
  properties: {
    value: bootstrapAdministratorPassword
  }
}

resource xapiJobSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'speaking-lab-xapi-job-token'
  properties: {
    value: xapiJobToken
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: environmentName
  location: location
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: containerAppsSubnet.id
      internal: false
    }
    zoneRedundant: false
  }
}

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: databaseUrlSecret.properties.secretUri
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: appImage
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL_MODE', value: 'verify-full' }
            { name: 'DATABASE_SSL_CA_PATH', value: '/app/certs/supabase-prod-ca-2021.pem' }
            { name: 'DB_POOL_MAX', value: '3' }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'AZURE_KEY_VAULT_URL', value: vault.properties.vaultUri }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
            { name: 'AZURE_AUDIO_CONTAINER', value: audioContainerName }
            { name: 'SESSION_COOKIE_SECURE', value: 'true' }
            { name: 'XAPI_SOURCE_APP', value: 'speaking-lab' }
            { name: 'XAPI_ACTOR_HOMEPAGE', value: 'https://saif.rsaf.mil' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health/live', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health/ready', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 6
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

var jobSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: databaseUrlSecret.properties.secretUri
    identity: identity.id
  }
  {
    name: 'xapi-job-token'
    keyVaultUrl: xapiJobSecret.properties.secretUri
    identity: identity.id
  }
]

resource migrationJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-migration'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      secrets: jobSecrets
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    }
    template: {
      containers: [
        {
          name: 'migration'
          image: jobsImage
          command: ['node', '/app/jobs/migrate.mjs']
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL_MODE', value: 'verify-full' }
            { name: 'DATABASE_SSL_CA_PATH', value: '/app/certs/supabase-prod-ca-2021.pem' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

resource xapiJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-xapi'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 300
      replicaRetryLimit: 2
      secrets: jobSecrets
      scheduleTriggerConfig: {
        cronExpression: '*/15 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'xapi'
          image: jobsImage
          command: ['node', '/app/jobs/xapi.mjs']
          env: [
            { name: 'APP_BASE_URL', value: 'https://${app.properties.configuration.ingress.fqdn}' }
            { name: 'XAPI_JOB_TOKEN', secretRef: 'xapi-job-token' }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
    }
  }
}

resource backupJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-backup'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      secrets: jobSecrets
      scheduleTriggerConfig: {
        cronExpression: '0 2 * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'backup'
          image: jobsImage
          command: ['node', '/app/jobs/backup.mjs']
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL_MODE', value: 'verify-full' }
            { name: 'DATABASE_SSL_CA_PATH', value: '/app/certs/supabase-prod-ca-2021.pem' }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
            { name: 'AZURE_BACKUP_CONTAINER', value: backupContainerName }
            { name: 'AZURE_AUDIO_CONTAINER', value: audioContainerName }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

output containerAppName string = app.name
output containerAppUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output containerAppsEnvironmentName string = environment.name
output migrationJobName string = migrationJob.name
output xapiJobName string = xapiJob.name
output backupJobName string = backupJob.name
output runtimeIdentityClientId string = identity.properties.clientId
output databaseProvider string = 'external-postgresql'
output minimumReplicas int = 0

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

@description('Enable signed SAIF launch SSO only after the issuer and shared secret have been agreed.')
param externalSsoEnabled bool = false

@description('Stable identifier used for SAIF identity links and replay protection.')
param externalSsoProviderId string = 'saif'

@description('Exact JWT issuer supplied by SAIF. Leave empty while SSO is disabled.')
param externalSsoIssuer string = ''

@description('Exact JWT audience for Speaking Lab.')
param externalSsoAudience string = 'speaking-lab'

@secure()
@description('HS256 launch secret exchanged out of band. Leave empty while SSO is disabled.')
param externalSsoSharedSecret string = ''

@description('Enable delivery from the PostgreSQL xAPI outbox only after SAIF LRS onboarding.')
param xapiEnabled bool = false

@description('SAIF LRS statements endpoint. Leave empty while xAPI delivery is disabled.')
param xapiLrsUrl string = ''

@secure()
@description('SAIF LRS Basic Auth username. Leave empty while xAPI delivery is disabled.')
param xapiUsername string = ''

@secure()
@description('SAIF LRS Basic Auth password. Leave empty while xAPI delivery is disabled.')
param xapiPassword string = ''

var environmentName = '${prefix}-trial-env'
var appName = '${prefix}-app'
var audioContainerName = 'speaking-audio'
var backupContainerName = 'database-backups'
var externalSsoConfigurationComplete = !empty(externalSsoIssuer) && !empty(externalSsoAudience) && length(externalSsoSharedSecret) >= 32
var xapiConfigurationComplete = !empty(xapiLrsUrl) && !empty(xapiUsername) && !empty(xapiPassword)
var effectiveExternalSsoEnabled = externalSsoEnabled && externalSsoConfigurationComplete
var effectiveXapiEnabled = xapiEnabled && xapiConfigurationComplete

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

resource externalSsoSharedSecretKv 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(externalSsoSharedSecret)) {
  parent: vault
  name: 'speaking-lab-external-sso-shared-secret'
  properties: {
    value: externalSsoSharedSecret
  }
}

resource xapiUsernameKv 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(xapiUsername)) {
  parent: vault
  name: 'speaking-lab-xapi-username'
  properties: {
    value: xapiUsername
  }
}

resource xapiPasswordKv 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(xapiPassword)) {
  parent: vault
  name: 'speaking-lab-xapi-password'
  properties: {
    value: xapiPassword
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

var applicationSecrets = concat(
  [
    {
      name: 'database-url'
      keyVaultUrl: databaseUrlSecret.properties.secretUri
      identity: identity.id
    }
  ],
  !empty(externalSsoSharedSecret) ? [
    {
      name: 'external-sso-shared-secret'
      keyVaultUrl: externalSsoSharedSecretKv!.properties.secretUri
      identity: identity.id
    }
  ] : [],
  !empty(xapiUsername) && !empty(xapiPassword) ? [
    {
      name: 'xapi-username'
      keyVaultUrl: xapiUsernameKv!.properties.secretUri
      identity: identity.id
    }
    {
      name: 'xapi-password'
      keyVaultUrl: xapiPasswordKv!.properties.secretUri
      identity: identity.id
    }
  ] : []
)

var applicationEnvironment = concat(
  [
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
    { name: 'EXTERNAL_SSO_ENABLED', value: string(effectiveExternalSsoEnabled) }
    { name: 'EXTERNAL_SSO_PROVIDER_ID', value: externalSsoProviderId }
    { name: 'EXTERNAL_SSO_ISSUER', value: externalSsoIssuer }
    { name: 'EXTERNAL_SSO_AUDIENCE', value: externalSsoAudience }
    { name: 'EXTERNAL_SSO_ALLOW_ADMIN', value: 'false' }
    { name: 'XAPI_ENABLED', value: string(effectiveXapiEnabled) }
    { name: 'XAPI_LRS_URL', value: xapiLrsUrl }
    { name: 'XAPI_SOURCE_APP', value: 'speaking-lab' }
    { name: 'XAPI_ACTOR_HOMEPAGE', value: 'https://saif.rsaf.mil' }
  ],
  !empty(externalSsoSharedSecret) ? [
    { name: 'EXTERNAL_SSO_SHARED_SECRET', secretRef: 'external-sso-shared-secret' }
  ] : [],
  !empty(xapiUsername) && !empty(xapiPassword) ? [
    { name: 'XAPI_USERNAME', secretRef: 'xapi-username' }
    { name: 'XAPI_PASSWORD', secretRef: 'xapi-password' }
  ] : []
)

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
      secrets: applicationSecrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: appImage
          env: applicationEnvironment
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
output externalSsoIsEnabled bool = effectiveExternalSsoEnabled
output xapiIsEnabled bool = effectiveXapiEnabled

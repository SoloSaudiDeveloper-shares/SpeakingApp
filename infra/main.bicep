targetScope = 'resourceGroup'

@description('Azure region approved for the pilot.')
param location string = 'uksouth'

@minLength(3)
@maxLength(12)
param prefix string = 'speakinglab'

@secure()
@minLength(16)
param postgresAdministratorPassword string

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

param postgresAdministratorLogin string = 'speakingadmin'
param initialAppImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param initialJobsImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var safePrefix = toLower(replace(prefix, '-', ''))
var appName = '${prefix}-app'
var environmentName = '${prefix}-env'
var postgresName = take('${safePrefix}pg${suffix}', 63)
var storageName = take('${safePrefix}st${suffix}', 24)
var modelStorageName = take('${safePrefix}models${suffix}', 24)
var registryName = take('${safePrefix}acr${suffix}', 50)
var vaultName = take('${safePrefix}-kv-${suffix}', 24)
var settingsVaultName = take('${safePrefix}-settings-${suffix}', 24)
var databaseName = 'speaking_lab'
var databaseHost = '${postgresName}.postgres.database.azure.com'
var databaseUrl = 'postgresql://${postgresAdministratorLogin}:${uriComponent(postgresAdministratorPassword)}@${databaseHost}:5432/${databaseName}?sslmode=require'
var externalSsoConfigurationComplete = !empty(externalSsoIssuer) && !empty(externalSsoAudience) && length(externalSsoSharedSecret) >= 32
var xapiConfigurationComplete = !empty(xapiLrsUrl) && !empty(xapiUsername) && !empty(xapiPassword)
var effectiveExternalSsoEnabled = externalSsoEnabled && externalSsoConfigurationComplete
var effectiveXapiEnabled = xapiEnabled && xapiConfigurationComplete

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-runtime'
  location: location
}

resource jobsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-jobs-runtime'
  location: location
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: ['10.42.0.0/16']
    }
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'container-apps'
  properties: {
    addressPrefix: '10.42.0.0/23'
    delegations: [
      {
        name: 'container-apps-delegation'
        properties: {
          serviceName: 'Microsoft.App/environments'
        }
      }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'postgres'
  properties: {
    addressPrefix: '10.42.2.0/24'
    delegations: [
      {
        name: 'postgres-delegation'
        properties: {
          serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
        }
      }
    ]
  }
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'private-endpoints'
  properties: {
    addressPrefix: '10.42.3.0/24'
    privateEndpointNetworkPolicies: 'Disabled'
  }
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}.private.postgres.database.azure.com'
  location: 'global'
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: 'vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: postgresName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    version: '17'
    createMode: 'Default'
    backup: {
      backupRetentionDays: 30
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresDns.id
      publicNetworkAccess: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
  dependsOn: [postgresDnsLink]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
  }
}

resource audioContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'speaking-audio'
  properties: {
    publicAccess: 'None'
  }
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'database-backups'
  properties: {
    publicAccess: 'None'
  }
}

// Public model delivery is deliberately isolated from private recordings and
// backups. Blob-level public access permits immutable file reads but not
// container listing, and shared-key authorization remains disabled.
resource modelStorage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: modelStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource modelBlobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: modelStorage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    cors: {
      corsRules: [
        {
          allowedHeaders: ['If-None-Match', 'Range']
          allowedMethods: ['GET', 'HEAD', 'OPTIONS']
          allowedOrigins: ['*']
          exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type', 'ETag']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource modelContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: modelBlobService
  name: 'voice-models'
  properties: {
    publicAccess: 'Blob'
    immutableStorageWithVersioning: {
      enabled: true
    }
  }
}

resource blobDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.blob.${az.environment().suffixes.storage}'
  location: 'global'
}

resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobDns
  name: 'vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource blobEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${prefix}-blob-pe'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: ['blob']
        }
      }
    ]
  }
}

resource blobDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobDns.id
        }
      }
    ]
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: registryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    policies: {
      quarantinePolicy: { status: 'disabled' }
      retentionPolicy: { days: 7, status: 'disabled' }
      trustPolicy: { type: 'Notary', status: 'disabled' }
    }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 14
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

// Provider credentials changed through Admin settings live in a separate
// vault. The web identity can create versions here without gaining mutation
// rights over database, SSO, backup, or job credentials.
resource settingsVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: settingsVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
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

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'acr-pull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(audioContainer.id, identity.id, 'audio-blob-data')
  scope: audioContainer
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource settingsVaultSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(settingsVault.id, identity.id, 'settings-vault-secrets')
  scope: settingsVault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    // Key Vault Secrets Officer: the Admin settings API must be able to
    // create, replace, and clear provider credentials as well as read them.
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  }
}

resource vaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, 'runtime-vault-read')
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource jobsAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, jobsIdentity.id, 'jobs-acr-pull')
  scope: registry
  properties: {
    principalId: jobsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource jobsVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, jobsIdentity.id, 'jobs-vault-read')
  scope: vault
  properties: {
    principalId: jobsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource jobsAudioContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(audioContainer.id, jobsIdentity.id, 'jobs-audio-data')
  scope: audioContainer
  properties: {
    principalId: jobsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource jobsBackupContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(backupContainer.id, jobsIdentity.id, 'jobs-backup-data')
  scope: backupContainer
  properties: {
    principalId: jobsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableIpMasking: false
    RetentionInDays: 30
    SamplingPercentage: 100
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
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
    {
      name: 'xapi-job-token'
      keyVaultUrl: xapiJobSecret.properties.secretUri
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
    { name: 'DB_POOL_MAX', value: '3' }
    { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
    { name: 'AZURE_KEY_VAULT_URL', value: settingsVault.properties.vaultUri }
    { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
    { name: 'AZURE_AUDIO_CONTAINER', value: audioContainer.name }
    { name: 'VOICE_MODEL_BASE_URL', value: '${modelStorage.properties.primaryEndpoints.blob}${modelContainer.name}/' }
    { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsights.properties.ConnectionString }
    { name: 'SESSION_COOKIE_SECURE', value: 'true' }
    { name: 'EXTERNAL_SSO_ENABLED', value: string(effectiveExternalSsoEnabled) }
    { name: 'EXTERNAL_SSO_PROVIDER_ID', value: externalSsoProviderId }
    { name: 'EXTERNAL_SSO_ISSUER', value: externalSsoIssuer }
    { name: 'EXTERNAL_SSO_AUDIENCE', value: externalSsoAudience }
    { name: 'EXTERNAL_SSO_ALLOW_ADMIN', value: 'false' }
    { name: 'XAPI_ENABLED', value: string(effectiveXapiEnabled) }
    { name: 'XAPI_JOB_TOKEN', secretRef: 'xapi-job-token' }
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
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: applicationSecrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: initialAppImage
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
        maxReplicas: 2
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [acrPull, blobContributor, settingsVaultSecretsOfficer, vaultSecretsUser, database]
}

var jobSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: databaseUrlSecret.properties.secretUri
    identity: jobsIdentity.id
  }
  {
    name: 'xapi-job-token'
    keyVaultUrl: xapiJobSecret.properties.secretUri
    identity: jobsIdentity.id
  }
]

resource migrationJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-migration'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${jobsIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      registries: [{ server: registry.properties.loginServer, identity: jobsIdentity.id }]
      secrets: jobSecrets
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
    }
    template: {
      containers: [
        {
          name: 'migration'
          image: initialJobsImage
          command: ['node', '/app/jobs/migrate.mjs']
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL_MODE', value: 'verify-full' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
  dependsOn: [jobsAcrPull, jobsVaultSecretsUser]
}

resource xapiJob 'Microsoft.App/jobs@2025-01-01' = if (effectiveXapiEnabled) {
  name: '${prefix}-xapi'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${jobsIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 300
      replicaRetryLimit: 2
      registries: [{ server: registry.properties.loginServer, identity: jobsIdentity.id }]
      secrets: jobSecrets
      scheduleTriggerConfig: {
        cronExpression: '*/5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'xapi'
          image: initialJobsImage
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
  dependsOn: [jobsAcrPull, jobsVaultSecretsUser]
}

// This probe exercises cold-start and warm delivery separately. It logs
// time-to-first-byte, total time, and bytes received so a fast response-start
// cannot hide a stalled body transfer.
resource deliveryProbeJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-delivery-probe'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${jobsIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 180
      replicaRetryLimit: 1
      registries: [{ server: registry.properties.loginServer, identity: jobsIdentity.id }]
      secrets: jobSecrets
      scheduleTriggerConfig: {
        cronExpression: '0 5 * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'delivery-probe'
          image: initialJobsImage
          command: ['/bin/sh', '-c']
          args: [
            'set -eu; URL="https://${app.properties.configuration.ingress.fqdn}/api/health/delivery"; for PHASE in cold warm; do curl --fail --show-error --silent --header "Authorization: Bearer $XAPI_JOB_TOKEN" --output "/tmp/$PHASE.body" --write-out "target=app phase=$PHASE status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}\\n" --max-time 60 "$URL"; test "$(wc -c < "/tmp/$PHASE.body")" -eq 2097152; done; curl --fail --show-error --silent --output /tmp/model-manifest.json "${modelStorage.properties.primaryEndpoints.blob}${modelContainer.name}/manifest.json"; PROBE_PATH="$(node -e "const m=require(\\"/tmp/model-manifest.json\\"); if(!m.probePath) process.exit(1); process.stdout.write(m.probePath)")"; PROBE_SHA="$(node -e "const m=require(\\"/tmp/model-manifest.json\\"); if(!m.probeSha256) process.exit(1); process.stdout.write(m.probeSha256)")"; curl --fail --show-error --silent --output /tmp/model-probe.bin --write-out "target=model status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}\\n" --max-time 90 "${modelStorage.properties.primaryEndpoints.blob}${modelContainer.name}/$PROBE_PATH"; echo "$PROBE_SHA  /tmp/model-probe.bin" | sha256sum --check --strict'
          ]
          env: [
            { name: 'XAPI_JOB_TOKEN', secretRef: 'xapi-job-token' }
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
    }
  }
  dependsOn: [jobsAcrPull, jobsVaultSecretsUser]
}

resource backupJob 'Microsoft.App/jobs@2025-01-01' = {
  name: '${prefix}-backup'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${jobsIdentity.id}': {} }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      registries: [{ server: registry.properties.loginServer, identity: jobsIdentity.id }]
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
          image: initialJobsImage
          command: ['node', '/app/jobs/backup.mjs']
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DATABASE_SSL_MODE', value: 'verify-full' }
            { name: 'AZURE_CLIENT_ID', value: jobsIdentity.properties.clientId }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
            { name: 'AZURE_BACKUP_CONTAINER', value: backupContainer.name }
            { name: 'AZURE_AUDIO_CONTAINER', value: audioContainer.name }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
  dependsOn: [
    jobsAcrPull
    jobsVaultSecretsUser
    jobsAudioContributor
    jobsBackupContributor
  ]
}

output containerAppName string = app.name
output containerAppUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output migrationJobName string = migrationJob.name
output xapiJobName string = effectiveXapiEnabled ? xapiJob!.name : ''
output backupJobName string = backupJob.name
output deliveryProbeJobName string = deliveryProbeJob.name
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output keyVaultName string = vault.name
output storageAccountName string = storage.name
output modelStorageAccountName string = modelStorage.name
output modelContainerUrl string = '${modelStorage.properties.primaryEndpoints.blob}${modelContainer.name}/'
output applicationInsightsName string = applicationInsights.name
output postgresServerName string = postgres.name
output runtimeIdentityClientId string = identity.properties.clientId
output jobsRuntimeIdentityClientId string = jobsIdentity.properties.clientId
output settingsKeyVaultName string = settingsVault.name
output externalSsoIsEnabled bool = effectiveExternalSsoEnabled
output xapiIsEnabled bool = effectiveXapiEnabled

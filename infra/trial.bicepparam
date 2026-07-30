using './trial.bicep'

param location = 'uksouth'
param prefix = 'speakinglab'
param virtualNetworkName = 'speakinglab-vnet'
param containerAppsSubnetName = 'container-apps'
param runtimeIdentityName = 'speakinglab-runtime'
param storageAccountName = 'speakinglabst20260729'
param keyVaultName = 'speakinglab-kv-20260729'
param appImage = readEnvironmentVariable('TRIAL_APP_IMAGE')
param jobsImage = readEnvironmentVariable('TRIAL_JOBS_IMAGE')
param databaseUrl = readEnvironmentVariable('DATABASE_URL')
param bootstrapAdministratorPassword = readEnvironmentVariable('BOOTSTRAP_ADMIN_PASSWORD')
param xapiJobToken = readEnvironmentVariable('XAPI_JOB_TOKEN')

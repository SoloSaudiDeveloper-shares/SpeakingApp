using './main.bicep'

param location = 'uksouth'
param prefix = 'speakinglab'
param postgresAdministratorLogin = 'speakingadmin'
param postgresAdministratorPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param bootstrapAdministratorPassword = readEnvironmentVariable('BOOTSTRAP_ADMIN_PASSWORD')
param xapiJobToken = readEnvironmentVariable('XAPI_JOB_TOKEN')

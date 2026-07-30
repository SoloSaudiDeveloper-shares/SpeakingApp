param(
    [Parameter(Mandatory = $true)]
    [string]$VaultName,

    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string]$UsernameSecretName,

    [Parameter(Mandatory = $true)]
    [string]$PasswordSecretName,

    [Parameter(Mandatory = $true)]
    [string]$UsernameValue
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
$roleName = 'Key Vault Secrets Officer'

function Set-KeyVaultSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Value,

        [Parameter(Mandatory = $true)]
        [string]$AccessToken
    )

    $uri = "https://$VaultName.vault.azure.net/secrets/$Name`?api-version=7.4"
    $headers = @{
        Authorization = "Bearer $AccessToken"
        'Content-Type' = 'application/json'
    }
    $body = @{ value = $Value } | ConvertTo-Json -Compress

    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $null = Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $body
            return
        }
        catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($statusCode -eq 403 -and $attempt -lt 12) {
                Start-Sleep -Seconds 10
                continue
            }
            throw
        }
    }
}

$plainPassword = $null
$accessToken = $null
$credential = $null
$temporaryIpRuleAdded = $false
$temporaryRoleAdded = $false
$currentIp = $null
$vaultId = $null
$userId = $null
$succeeded = $false

try {
    Clear-Host
    Write-Host 'Speaking Lab - secure SAIF LRS onboarding' -ForegroundColor Cyan
    Write-Host
    Write-Host 'Enter the supplied LRS password below. It will not be displayed,'
    Write-Host 'written to a file, placed in command history, or printed to the console.'
    Write-Host

    $securePassword = Read-Host 'LRS password' -AsSecureString
    $credential = [System.Net.NetworkCredential]::new('', $securePassword)
    $plainPassword = $credential.Password
    if ([string]::IsNullOrWhiteSpace($plainPassword)) {
        throw 'No password was entered.'
    }

    $currentIp = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()
    $parsedIp = $null
    if (-not [System.Net.IPAddress]::TryParse($currentIp, [ref]$parsedIp)) {
        throw 'The current public IP address could not be validated.'
    }

    $vaultJson = & $az keyvault show `
        --resource-group $ResourceGroup `
        --name $VaultName `
        --output json
    if ($LASTEXITCODE -ne 0) {
        throw 'Azure CLI could not read the Key Vault.'
    }
    $vault = $vaultJson | ConvertFrom-Json
    $vaultId = $vault.id
    $userId = (& $az ad signed-in-user show --query id --output tsv).Trim()
    if ([string]::IsNullOrWhiteSpace($vaultId) -or [string]::IsNullOrWhiteSpace($userId)) {
        throw 'Azure CLI could not resolve the vault or signed-in user.'
    }

    $ipRuleExists = @($vault.properties.networkAcls.ipRules).value -contains "$currentIp/32"
    if (-not $ipRuleExists) {
        & $az keyvault network-rule add `
            --resource-group $ResourceGroup `
            --name $VaultName `
            --ip-address "$currentIp/32" `
            --output none
        if ($LASTEXITCODE -ne 0) {
            throw 'Azure rejected the temporary Key Vault network rule.'
        }
        $temporaryIpRuleAdded = $true
    }

    $existingRolesJson = & $az role assignment list `
        --assignee $userId `
        --scope $vaultId `
        --role $roleName `
        --output json
    if ($LASTEXITCODE -ne 0) {
        throw 'Azure CLI could not inspect vault role assignments.'
    }
    $existingRoles = $existingRolesJson | ConvertFrom-Json
    if (@($existingRoles).Count -eq 0) {
        & $az role assignment create `
            --assignee-object-id $userId `
            --assignee-principal-type User `
            --role $roleName `
            --scope $vaultId `
            --output none
        if ($LASTEXITCODE -ne 0) {
            throw 'Azure rejected the temporary vault-scoped role assignment.'
        }
        $temporaryRoleAdded = $true
    }

    $accessToken = (& $az account get-access-token `
        --resource 'https://vault.azure.net' `
        --query accessToken `
        --output tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
        throw 'Azure CLI could not obtain a Key Vault access token.'
    }

    Set-KeyVaultSecret `
        -Name $UsernameSecretName `
        -Value $UsernameValue `
        -AccessToken $accessToken
    Set-KeyVaultSecret `
        -Name $PasswordSecretName `
        -Value $plainPassword `
        -AccessToken $accessToken

    $succeeded = $true
}
catch {
    Write-Host
    Write-Host 'Secret onboarding failed. No secret value was printed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
    $plainPassword = $null
    $accessToken = $null
    if ($credential) {
        $credential.Password = $null
    }

    if ($temporaryRoleAdded -and $userId -and $vaultId) {
        & $az role assignment delete `
            --assignee $userId `
            --role $roleName `
            --scope $vaultId `
            --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Warning: the temporary vault role could not be removed automatically.' -ForegroundColor Yellow
            $succeeded = $false
        }
    }

    if ($temporaryIpRuleAdded -and $currentIp) {
        & $az keyvault network-rule remove `
            --resource-group $ResourceGroup `
            --name $VaultName `
            --ip-address "$currentIp/32" `
            --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Warning: the temporary firewall rule could not be removed automatically.' -ForegroundColor Yellow
            $succeeded = $false
        }
    }

    Write-Host
    if ($succeeded) {
        Write-Host 'Both Key Vault secrets were stored successfully.' -ForegroundColor Green
        Write-Host 'Temporary vault access was removed.' -ForegroundColor Green
    }
    else {
        Write-Host 'Onboarding did not complete. No credential value was printed.' -ForegroundColor Red
    }
}

if (-not $succeeded) {
    exit 1
}

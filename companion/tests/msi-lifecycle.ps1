[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $VersionOneMsi,

    [Parameter(Mandatory = $true)]
    [string] $VersionTwoMsi,

    [Parameter(Mandatory = $true)]
    [string] $LogDirectory
)

$ErrorActionPreference = "Stop"
$serviceName = "SpeakingLabVoiceCompanion"
$versionOnePath = [IO.Path]::GetFullPath($VersionOneMsi)
$versionTwoPath = [IO.Path]::GetFullPath($VersionTwoMsi)
$logsPath = [IO.Path]::GetFullPath($LogDirectory)
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null

function Invoke-MsiExec {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,

        [Parameter(Mandatory = $true)]
        [string] $LogName,

        [int[]] $AllowedExitCodes = @(0, 3010)
    )

    $logPath = Join-Path $logsPath $LogName
    $process = Start-Process msiexec.exe -WindowStyle Hidden -Wait -PassThru `
        -ArgumentList @($Arguments + @("/norestart", "/l*v", $logPath))
    if ($process.ExitCode -notin $AllowedExitCodes) {
        throw "msiexec failed with code $($process.ExitCode). See $logPath."
    }
}

try {
    Invoke-MsiExec -Arguments @("/i", $versionOnePath, "/qn") -LogName "install-v1.log"
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    if (-not $service -or $service.StartName -ne "NT AUTHORITY\LocalService") {
        throw "The MSI did not install the service under LocalService."
    }

    Invoke-MsiExec -Arguments @("/fa", $versionOnePath, "/qn") -LogName "repair-v1.log"
    if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
        throw "The service was missing after MSI repair."
    }

    Invoke-MsiExec -Arguments @("/i", $versionTwoPath, "/qn") -LogName "upgrade-v2.log"
    if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
        throw "The service was missing after the major upgrade."
    }
}
finally {
    Invoke-MsiExec -Arguments @("/x", $versionTwoPath, "/qn") `
        -LogName "uninstall-v2.log" -AllowedExitCodes @(0, 1605, 3010)
    Invoke-MsiExec -Arguments @("/x", $versionOnePath, "/qn") `
        -LogName "uninstall-v1.log" -AllowedExitCodes @(0, 1605, 3010)
}

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "The service still exists after MSI uninstall."
}

Write-Host "MSI install, repair, major upgrade, and uninstall passed."

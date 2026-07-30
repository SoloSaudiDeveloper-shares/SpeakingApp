[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ServiceDirectory,

    [Parameter(Mandatory = $true)]
    [string] $WorkerExecutable,

    [Parameter(Mandatory = $true)]
    [string] $ModelSourceDirectory,

    [Parameter(Mandatory = $true)]
    [string] $OutputDirectory
)

$ErrorActionPreference = "Stop"
$origin = "https://ci.speaking-lab.invalid"
$modelPort = 18443
$servicePort = 17841
$releaseName = "0123456789abcdef0123456789abcdef01234567"

$serviceDirectoryPath = [IO.Path]::GetFullPath($ServiceDirectory)
$workerSourcePath = [IO.Path]::GetFullPath($WorkerExecutable)
$modelSourcePath = [IO.Path]::GetFullPath($ModelSourceDirectory)
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $serviceDirectoryPath -PathType Container)) {
    throw "Service publish directory was not found."
}
if (-not (Test-Path -LiteralPath $workerSourcePath -PathType Leaf)) {
    throw "Frozen worker executable was not found."
}
foreach ($fileName in @("model.onnx", "voices.bin")) {
    if (-not (Test-Path -LiteralPath (Join-Path $modelSourcePath $fileName) -PathType Leaf)) {
        throw "Required signed-model fixture $fileName was not found."
    }
}

New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$dataPath = Join-Path $outputPath "data"
$serverRoot = Join-Path $outputPath "model-server"
$releasePath = Join-Path $serverRoot "releases\$releaseName"
$logsPath = Join-Path $outputPath "logs"
New-Item -ItemType Directory -Path $dataPath, $releasePath, $logsPath -Force | Out-Null

$serviceExecutable = Join-Path $serviceDirectoryPath "SpeakingLab.Companion.exe"
$packagedWorker = Join-Path $serviceDirectoryPath "SpeakingLab.KokoroWorker.exe"
$publicKeyPath = Join-Path $serviceDirectoryPath "voice-model-public.pem"
Copy-Item -LiteralPath $workerSourcePath -Destination $packagedWorker -Force
Copy-Item -LiteralPath (Join-Path $modelSourcePath "model.onnx") -Destination (Join-Path $releasePath "model.onnx") -Force
Copy-Item -LiteralPath (Join-Path $modelSourcePath "voices.bin") -Destination (Join-Path $releasePath "voices.bin") -Force

$signingKey = Join-Path $outputPath "voice-model-signing.pem"
& openssl ecparam -name secp384r1 -genkey -noout -out $signingKey
if ($LASTEXITCODE -ne 0) { throw "Failed to generate the model signing key." }
& openssl pkey -in $signingKey -pubout -out $publicKeyPath
if ($LASTEXITCODE -ne 0) { throw "Failed to export the model signing public key." }

$files = @()
foreach ($fileName in @("model.onnx", "voices.bin")) {
    $filePath = Join-Path $releasePath $fileName
    $files += [ordered]@{
        path = "releases/$releaseName/$fileName"
        bytes = (Get-Item -LiteralPath $filePath).Length
        sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$probe = $files | Sort-Object bytes -Descending | Select-Object -First 1
$manifest = [ordered]@{
    schemaVersion = 1
    release = $releaseName
    modelId = "kokoro-82m-v1.0-onnx"
    createdAt = [DateTimeOffset]::UtcNow.ToString("O")
    probePath = $probe.path
    probeBytes = $probe.bytes
    probeSha256 = $probe.sha256
    files = $files
}
$manifestPath = Join-Path $serverRoot "manifest.json"
$signaturePath = Join-Path $serverRoot "manifest.sig"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
& openssl dgst -sha256 -sign $signingKey -out $signaturePath $manifestPath
if ($LASTEXITCODE -ne 0) { throw "Failed to sign the model manifest." }
& openssl dgst -sha256 -verify $publicKeyPath -signature $signaturePath $manifestPath
if ($LASTEXITCODE -ne 0) { throw "The generated model signature did not verify." }

$tlsKey = Join-Path $outputPath "localhost.key"
$tlsCertificate = Join-Path $outputPath "localhost.crt"
& openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes `
    -keyout $tlsKey -out $tlsCertificate -subj "/CN=localhost" `
    -addext "subjectAltName=DNS:localhost"
if ($LASTEXITCODE -ne 0) { throw "Failed to create the release-gate TLS certificate." }
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($tlsCertificate)
& certutil -user -addstore Root $tlsCertificate | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to trust the release-gate TLS certificate." }

$modelServer = $null
$companion = $null
try {
    $modelServer = Start-Process python -WindowStyle Hidden -PassThru `
        -ArgumentList @(
            (Join-Path $PSScriptRoot "https_model_server.py"),
            "--root", $serverRoot,
            "--certificate", $tlsCertificate,
            "--key", $tlsKey,
            "--port", "$modelPort"
        ) `
        -RedirectStandardOutput (Join-Path $logsPath "model-server.stdout.log") `
        -RedirectStandardError (Join-Path $logsPath "model-server.stderr.log")

    $modelBaseUrl = "https://localhost:$modelPort/"
    $serverReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            Invoke-WebRequest -Uri "${modelBaseUrl}manifest.json" -UseBasicParsing | Out-Null
            $serverReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $serverReady) { throw "The TLS model fixture server did not become ready." }

    $pairingOutput = & $serviceExecutable `
        --data-dir $dataPath `
        --allowed-origin $origin `
        --rotate-pairing-only
    if ($LASTEXITCODE -ne 0 -or $pairingOutput -notmatch "(\d{6})") {
        throw "The companion did not generate a pairing code."
    }
    $pairingCode = $Matches[1]

    $modelInstallOutput = & $serviceExecutable `
        --data-dir $dataPath `
        --allowed-origin $origin `
        --authorize-model-install-only
    if ($LASTEXITCODE -ne 0 -or $modelInstallOutput -notmatch "(\d{6})") {
        throw "The companion did not generate a model-install code."
    }
    $modelInstallCode = $Matches[1]

    $companion = Start-Process $serviceExecutable -WindowStyle Hidden -PassThru `
        -ArgumentList @(
            "--data-dir", $dataPath,
            "--allowed-origin", $origin,
            "--worker-executable", $packagedWorker,
            "--model-base-url", $modelBaseUrl,
            "--model-signing-public-key", $publicKeyPath
        ) `
        -RedirectStandardOutput (Join-Path $logsPath "companion.stdout.log") `
        -RedirectStandardError (Join-Path $logsPath "companion.stderr.log")

    $serviceBaseUrl = "http://127.0.0.1:$servicePort"
    $serviceReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-WebRequest -Uri "$serviceBaseUrl/health" -Headers @{ Origin = $origin } `
                -SkipHttpErrorCheck -UseBasicParsing | Out-Null
            $serviceReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $serviceReady) { throw "The packaged companion did not become ready." }

    $pairBody = @{ code = $pairingCode } | ConvertTo-Json -Compress
    $pairResult = Invoke-RestMethod -Uri "$serviceBaseUrl/pair" -Method Post `
        -Headers @{ Origin = $origin } -ContentType "application/json" -Body $pairBody
    if ([string]::IsNullOrWhiteSpace($pairResult.token)) {
        throw "The packaged companion did not issue a paired token."
    }
    $authorizedHeaders = @{
        Origin = $origin
        Authorization = "Bearer $($pairResult.token)"
    }

    $installBody = @{ code = $modelInstallCode } | ConvertTo-Json -Compress
    $installResult = Invoke-RestMethod -Uri "$serviceBaseUrl/v1/models/install" `
        -Method Post -Headers $authorizedHeaders -ContentType "application/json" `
        -Body $installBody -TimeoutSec 600
    if ($installResult.release -ne $releaseName) {
        throw "The signed model package did not activate."
    }

    $healthy = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "$serviceBaseUrl/health" -Headers @{ Origin = $origin }
            if ($health.workerReady -and $health.modelInstalled) {
                $healthy = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $healthy) { throw "The installed model and frozen worker did not become healthy." }

    $speechBody = @{
        model = "kokoro"
        input = "Speaking Lab release verification."
        voice = "af_heart"
        speed = 1
        responseFormat = "wav"
    } | ConvertTo-Json -Compress
    $audioPath = Join-Path $outputPath "release-smoke.wav"
    Invoke-WebRequest -Uri "$serviceBaseUrl/v1/audio/speech" -Method Post `
        -Headers $authorizedHeaders -ContentType "application/json" `
        -Body $speechBody -OutFile $audioPath -TimeoutSec 90

    $audioBytes = [IO.File]::ReadAllBytes($audioPath)
    if ($audioBytes.Length -le 44 -or
        [Text.Encoding]::ASCII.GetString($audioBytes, 0, 4) -ne "RIFF") {
        throw "The packaged worker did not produce a valid WAV response."
    }
}
finally {
    if ($companion -and -not $companion.HasExited) {
        Stop-Process -Id $companion.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $companion.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    Get-Process "SpeakingLab.KokoroWorker" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    if ($modelServer -and -not $modelServer.HasExited) {
        Stop-Process -Id $modelServer.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $modelServer.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    & certutil -user -delstore Root $certificate.Thumbprint | Out-Null
}

Write-Host "Frozen worker, signed model installation, pairing, and offline synthesis passed."

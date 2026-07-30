# Speaking Lab Local Voice Companion

The companion gives the browser a stable, authenticated loopback API for
locally installed voice models. It is intentionally separate from the web
application so schools can install or upgrade local models without rebuilding
the Azure-hosted app.

## Security boundary

- Kestrel binds only to `127.0.0.1:17841`.
- The companion accepts browser calls only from configured HTTPS origins.
- `/pair` exchanges a short-lived bootstrap code for a 256-bit bearer token
  bound to the exact approved browser origin.
- Only a SHA-256 digest of issued tokens is stored.
- Local model workers use a loopback address plus a random private service token;
  a browser cannot bypass the companion by calling the worker port.
- Health is successful only while the supervised worker process answers its
  authenticated health check. A stopped worker is restarted automatically.
- Speech requests are limited to 16 KiB, two concurrent syntheses, and 16 MiB
  responses.
- Provider errors are reduced to a request ID and safe message.
- The service never accepts a cloud API key from the browser.

## API

| Endpoint | Authentication | Purpose |
|---|---|---|
| `GET /health` | none | Minimal companion, worker, and pairing readiness |
| `POST /pair` | bootstrap code | Issue a device bearer token |
| `GET /v1/models` | bearer | List local models |
| `GET /v1/audio/voices` | bearer | List local voices |
| `POST /v1/audio/speech` | bearer | Return WAV audio from the local worker |

The worker contract is OpenAI-compatible. LocalAI, a packaged Kokoro worker, or
another locally installed server can implement the three `/v1/*` routes. The
default worker address is `http://127.0.0.1:17842`.

## Developer run

```powershell
dotnet run --project companion/src/SpeakingLab.Companion `
  -- --data-dir "$env:TEMP\SpeakingLabCompanion" `
  --allowed-origin "http://localhost:3000" `
  --rotate-pairing
```

The command prints a one-time pairing code. Remove `--rotate-pairing` on later
runs. Production installation uses `%ProgramData%\SpeakingLab\Companion`.
When running the worker separately during development, set the same
`SPEAKINGLAB_WORKER_TOKEN` value (at least 32 characters) for both processes.

On an installed PC, an administrator can rotate a pairing code without starting
a second server:

```powershell
& "$env:ProgramFiles\Speaking Lab Voice Companion\SpeakingLab.Companion.exe" `
  --data-dir "$env:ProgramData\SpeakingLab\Companion" --rotate-pairing-only
```

The six-digit code expires after 15 minutes and is invalidated after one
successful exchange.

Model installation requires a separate, one-time authorization from a Windows
administrator. Generate it from an elevated terminal, then enter it in Admin →
Voice settings:

```powershell
& "$env:ProgramFiles\Speaking Lab Voice Companion\SpeakingLab.Companion.exe" `
  --data-dir "$env:ProgramData\SpeakingLab\Companion" `
  --authorize-model-install-only
```

This code also expires after 15 minutes and is consumed by one installation
attempt. A normal paired-browser token cannot change machine-wide model files
without it.

## Packaging

`installer/Product.wxs` is a WiX v4 per-machine MSI foundation. Build and sign
the self-contained service first, then build the MSI:

```powershell
dotnet publish companion/src/SpeakingLab.Companion -c Release -r win-x64 `
  --self-contained true -o companion/artifacts/service
wix build companion/installer/Product.wxs -arch x64 `
  -ext WixToolset.Util.wixext `
  -d PackageVersion=1.0.0 `
  -d ServiceSource=companion/artifacts/service `
  -d WorkerSource=companion/artifacts/worker `
  -d ModelPublicKeySource=companion/artifacts/signing `
  -d ModelBaseUrl=https://models.example.blob.core.windows.net/voice-models/ `
  -d AppOrigin=https://speaking-lab.example.mil `
  -o companion/artifacts/SpeakingLabVoiceCompanion.msi
```

The MSI deliberately contains no large model files and no self-updater. IT
distributes signed MSI upgrades. The pinned public key verifies the detached
manifest signature; every model file is then size- and SHA-256-checked in a
staging directory before the complete package is atomically activated. The
paired `POST /v1/models/install` endpoint performs installation or upgrade.
Model files use resumable HTTP Range downloads with a rearmed 12-second
no-progress deadline and a 10-minute absolute ceiling. Admin Voice settings
shows verified byte progress and can cancel; retrying with the still-valid
one-time code resumes the partial package.

The 10-minute ceiling covers the whole installation attempt, including catalog
downloads, signature verification, resumed model downloads, and activation; it
is not reset for each HTTP request. Before an install, obsolete
`.download-*` directories are removed without following junctions or symbolic
links. The directory for the current signed release is retained for safe resume.

Kestrel enforces a 16 KiB global request-body maximum for both fixed-length and
chunked requests. Pairing and model-install authorization endpoints lower that
limit to 512 bytes. The speech format contract is WAV-only end to end.

The Windows `companion_release_gate` CI job installs the hash-locked Python
environment, freezes the worker, verifies a locally signed model manifest,
performs real Kokoro synthesis, builds two MSI versions, and exercises
install/repair/major-upgrade/uninstall. Its short-lived CI signatures prove the
packaging path only; production artifacts must still use the organization's
protected Authenticode certificate.

# Voice provider deployment

Speaking Lab supports organization-managed voice policy with device-scoped
credentials:

1. **Windows companion** — the safe local default; a signed per-machine service calls a packaged local
   Kokoro worker on loopback.
2. **Custom local server** — an OpenAI-compatible speech endpoint on approved
   `localhost` or `127.0.0.1` user ports.
3. **Azure Speech** — paid cloud API, streamed as MP3.
4. **OpenAI TTS** — paid cloud API, streamed as MP3.
5. **Browser system voice** — last-resort fallback.

Production web images do not include browser Kokoro/Piper model files and the
provider policy cannot select browser-local neural inference. Persisted legacy
browser-local policies are normalized to Windows companion Kokoro.

## Organization policy

Only Administrators can change the provider chain. Provider, model, and voice
each have an explicit **Set as default** action. A cloud provider cannot be
enabled until its secret is configured and its monthly character cap is
positive. Device overrides remain in IndexedDB and are ignored unless the
organization enables them.

Recommended order:

`Windows companion Kokoro -> Azure Speech -> OpenAI TTS -> system`

## Cloud setup

- Store `azure_speech_key` and `openai_api_key` in the existing secret store.
- Set the Azure Speech region.
- Choose an allowlisted voice and a positive monthly character cap.
- Test the provider from Admin Voice settings.
- Keep input at 1–1,000 Unicode characters and rate between 0.5 and 2.

The server reserves usage atomically before contacting a provider and applies a
per-user/per-provider request window. Provider keys and upstream response bodies
never reach logs or the browser.

## Windows companion

Build, sign, and distribute `companion/installer/Product.wxs` as an IT-managed
per-machine MSI. Build with the exact production HTTPS origin:

```powershell
dotnet publish companion/src/SpeakingLab.Companion -c Release -r win-x64 `
  --self-contained true -o companion/artifacts/service
wix build companion/installer/Product.wxs -arch x64 `
  -d ServiceSource=companion/artifacts/service `
  -d WorkerSource=companion/artifacts/worker `
  -d ModelPublicKeySource=companion/artifacts/signing `
  -d ModelBaseUrl=https://models.example.blob.core.windows.net/voice-models/ `
  -d AppOrigin=https://speaking-lab.example.mil `
  -o companion/artifacts/SpeakingLabVoiceCompanion.msi
```

The service binds only to `127.0.0.1:17841`; its worker binds to
`127.0.0.1:17842`. Pairing exchanges a six-digit, 15-minute bootstrap code for
a random device bearer token bound to the approved web origin. The browser
stores the token in IndexedDB and the service stores only its digest. The worker
also requires a private random token supplied by the supervising service, so
web pages cannot bypass companion authentication by addressing port 17842.
Installing or updating the machine-wide model requires a separate six-digit
authorization generated from an elevated local command. Pairing alone never
grants model mutation rights.
Downloads resume with HTTP Range, pause after 12 seconds without byte progress,
enforce one 10-minute ceiling over the whole installation, retain only the
current signed release's staging directory, remove stale staging trees without
following reparse points, and activate only after every declared byte count and
SHA-256 digest matches.

Large model packages are not part of the MSI. Production model activation must
verify a signed catalog and SHA-256 digest into a temporary file, then atomically
rename it into the active model directory. The first release has no self-updater;
IT distributes signed MSI upgrades.

The `Publish signed voice models` workflow creates versioned model paths, an
ECDSA-signed manifest, and a SHA-256-selected delivery probe object. Azure Blob
versioning, immutable storage with versioning, 30-day soft deletion, and
read-only browser CORS protect the publication channel. The signing public key
must be pinned into the companion release before model activation is enabled.

## Real-network validation

The Azure field guide showed that response-start latency can look healthy while
the body stalls. Release validation therefore records:

- provider and request ID;
- input character count, never input text;
- time to first byte;
- total elapsed time;
- audio bytes delivered;
- completion, cancellation, or stall failure.

Cloud audio uses compressed MP3. Companion Kokoro accepts and returns WAV only
because it does not cross the unreliable Azure/client network leg. A 12-second no-progress
stall timeout is separate from the 60-second absolute cap, and synthesis failure
must remain visible instead of advancing silently.

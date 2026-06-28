# Azure / Foundry Setup For Speaking Lab

This app uses three separate Azure-related capabilities:

1. AI feedback and scenario generation.
2. Speech-to-text transcription.
3. Pronunciation assessment.

Do not use a speech model as the AI feedback model. Speech models listen to students. Chat models write feedback, tutor insights, and scenarios.

## 1. AI Feedback And Scenarios

Use this for:

- AI Tutor Insight.
- Teacher AI insight.
- AI conversation replies.
- KLP scenario generation.
- Free Speak content/coherence comments.

Recommended model:

- `gpt-4o-mini` or another small/fast chat model available in your Azure AI Foundry project.

Do not use these here:

- `Azure-Speech-Speech-to-text`
- `MAI-Transcribe`
- `gpt-4o-transcribe`
- `whisper`
- `Azure-Speech-Text-to-speech`

App setup:

1. Go to Azure AI Foundry.
2. Create/open your project.
3. Deploy a chat model such as `gpt-4o-mini`.
4. Copy the model endpoint/key/deployment name.
5. In Speaking Lab, log in as admin.
6. Go to `Admin -> AI Settings`.
7. Select `Azure / Foundry`.
8. Fill:
   - Endpoint: your base endpoint, for example `https://spk-3458-resource.services.ai.azure.com`
   - API Key: your Azure/Foundry key
   - Deployment Name: the exact deployment name, for example `gpt-4o-mini`
   - API Version: `v1`
9. Save settings.

If Azure gives you a full URL ending in `/chat/completions`, paste the base resource endpoint instead. The app adds `/openai/v1` automatically.

## 2. Azure Speech-To-Text

Use this for:

- Turning student speech into text.
- Practice attempts.
- Diagnostic speaking check.
- Fluency drills.
- AI conversation voice input.

Recommended service:

- Azure AI Speech / Speech-to-text.

App setup:

1. In Azure, create or open an Azure AI Speech resource.
2. Copy one Speech key.
3. Copy the region, for example `eastus`, `uaenorth`, or `westeurope`.
4. In Speaking Lab, log in as admin.
5. Go to `Admin -> STT Settings`.
6. In the Azure Speech key section, paste:
   - Azure Speech key
   - Region
7. Save Azure key.
8. In the speech model cards, activate `Azure Speech (cloud)`.
9. Keep `Offline fallback` on unless you want Azure to be required every time.

What the app does:

- Records the student's microphone.
- Converts the recording to 16 kHz mono WAV.
- Sends it to Azure Speech-to-text through the server.
- Keeps the Azure key server-side.
- Falls back to the bundled offline Whisper model if Azure is unavailable and fallback is enabled.

## 3. Azure Pronunciation Assessment

Use this for:

- Phoneme-level pronunciation accuracy.
- Word-level evidence.
- Mispronunciation and omission detection.
- Weak Words pronunciation evidence.
- Better scoring for Repeat, Read Aloud, and shadowing/reference tasks.

App setup:

Use the same setup as Azure Speech-to-text:

1. Go to `Admin -> STT Settings`.
2. Paste the Azure Speech key.
3. Enter the region.
4. Save.

No separate model deployment is needed in the app. The same Azure Speech resource powers pronunciation assessment.

## Recommended Final Configuration

For a production-style customer demo:

- `Admin -> AI Settings`
  - Provider: `Azure / Foundry`
  - Model/deployment: `gpt-4o-mini`
  - API version: `v1`

- `Admin -> STT Settings`
  - Active STT model: `Azure Speech (cloud)`
  - Azure Speech key: configured
  - Region: configured
  - Offline fallback: on

This gives:

- Azure/Foundry for feedback and scenarios.
- Azure Speech for transcription.
- Azure Pronunciation Assessment for detailed scoring.
- Offline fallback if Azure Speech is unavailable.

## Quick Test

1. Log in as student `1 / 1`.
2. Open `Practice`.
3. Confirm the top STT selector shows `Azure Speech` or choose it from the menu.
4. Say a simple target word.
5. The result should show:
   - Speech: Azure Speech
   - Pronunciation: Azure, for reference stages when the Azure key is configured.

If transcription fails, check:

- The Speech key is correct.
- The region exactly matches the Azure Speech resource.
- The computer has internet access.
- Offline fallback is on.

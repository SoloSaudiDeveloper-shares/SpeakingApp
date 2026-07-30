# Kokoro worker

This worker provides the private OpenAI-compatible API consumed by the Windows
service. It binds only to `127.0.0.1:17842`; browsers must never call it
directly.

For development:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\pip install --require-hashes -r companion\worker\requirements.lock
$env:SPEAKINGLAB_WORKER_TOKEN = "development-only-worker-token-32-chars"
.\.venv\Scripts\python companion\worker\run.py
```

Start the companion from the same shell so it uses the same private worker
token. The installed service creates a random token and passes it to the worker
automatically.

Regenerate the lock after an intentional dependency update with:

```powershell
uv pip compile companion/worker/requirements.in --python-version 3.12 `
  --generate-hashes --no-header --output-file companion/worker/requirements.lock
```

Production packaging additionally requires:

- Python 3.12 and PyInstaller;
- a signed model catalog;
- SHA-256 verification into a temporary file;
- atomic rename into the active model directory;
- an offline start test after the verified model cache is staged.

The worker contract accepts `response_format: "wav"` only and returns
`audio/wav`. Azure and OpenAI cloud routes continue to emit compressed MP3 for
real-network delivery.

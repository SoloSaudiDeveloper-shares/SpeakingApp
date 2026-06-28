"use client"

/**
 * Configure transformers.js's onnxruntime-web to run OFFLINE and reliably:
 *   - wasmPaths = "/ort/"  → load the BUNDLED ORT wasm, not a CDN.
 *   - numThreads = 1       → no SharedArrayBuffer needed (Electron/dev aren't
 *                            cross-origin isolated).
 *   - proxy = false        → CRITICAL. With the proxy worker on, ORT pulls its
 *                            runtime from a CDN regardless of wasmPaths and dies
 *                            with "no available backend found" offline.
 *
 * transformers wires `env.backends.onnx` up ASYNCHRONOUSLY as onnxruntime-web
 * finishes loading, so `env.backends.onnx.wasm` is sometimes still undefined
 * when an engine first calls this — a race that made Kokoro (and offline
 * Whisper) intermittently fall back to the CDN and fail. We poll briefly until
 * the backend object exists, then configure it before any model session is
 * created.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyWasmConfig(wasm: any): boolean {
  if (!wasm) return false
  wasm.wasmPaths = "/ort/"
  wasm.numThreads = 1
  wasm.proxy = false
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function configureOrtEnv(env: any, opts: { allowRemoteModels?: boolean } = {}): Promise<void> {
  // (1) Configure onnxruntime-web DIRECTLY. transformers wires up
  // `env.backends.onnx` only if ORT is already loaded at its module-eval time;
  // when ORT loads lazily that path is never populated, so configuring through
  // transformers' env alone is unreliable (a race that left Kokoro on the CDN).
  // Importing onnxruntime-web here gives us the SAME shared instance and lets us
  // set the env before any inference session is created.
  try {
    // IMPORTANT: transformers v4 imports "onnxruntime-web/webgpu" (NOT the bare
    // "onnxruntime-web"), so we must configure that exact entry point to touch
    // the SAME shared env instance ORT actually uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ort: any = await import("onnxruntime-web/webgpu")
    applyWasmConfig(ort?.env?.wasm)
  } catch { /* fall through to the transformers env path */ }

  // (2) Also configure via transformers' env, polling briefly in case the ORT
  // backend is still being wired up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wasm: any = env?.backends?.onnx?.wasm
  for (let i = 0; i < 100 && !wasm; i++) {
    await new Promise((r) => setTimeout(r, 20))
    wasm = env?.backends?.onnx?.wasm
  }
  applyWasmConfig(wasm)

  if (env) {
    env.allowLocalModels = true
    env.localModelPath = "/models/"
    // Default OFF: bundled engines (Kokoro) must NEVER hit the internet — that's
    // what a download manager (IDM) intercepts. Callers that ship non-bundled,
    // download-on-demand models (some Whisper sizes) opt in explicitly.
    env.allowRemoteModels = opts.allowRemoteModels ?? false
  }
}

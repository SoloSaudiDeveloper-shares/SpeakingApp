"use client"

import type { SpeechEngine, SpeechRecognitionResult, STTEngineId } from "./types"
import { analyzeAudio, hasRealSpeech, isLikelyHallucination } from "./audio-analysis"
import { configureOrtEnv } from "./configure-ort"

/**
 * Speech-to-text engine powered by Transformers.js.
 *
 * Loads Whisper / Moonshine ONNX models directly from Hugging Face's CDN —
 * no third-party auth, no telemetry, no api.webai-js.com dependency.
 *
 * Once a model is downloaded the first time, it's cached in the browser's
 * Cache Storage and reused on every subsequent run (truly offline after that).
 */

/** ONNX weight precision we load and bundle. Keep in sync with
 *  scripts/fetch-stt-model.mjs (it downloads exactly these files).
 *  fp32 = full precision: the quantized Whisper exports (q8/uint8) use
 *  MatMulNBits, which onnxruntime-web 1.26 can't load; fp32 loads reliably
 *  and is actually faster on the WASM backend (no per-op dequantization). */
const STT_DTYPE = "fp32"

const MODEL_MAP: Record<STTEngineId, string> = {
  "azure-speech":         "Xenova/whisper-tiny.en", // unused (cloud engine)
  "groq-whisper":         "Xenova/whisper-tiny.en", // unused (cloud engine)
  "web-speech-api":       "Xenova/whisper-tiny.en", // unused, but typed
  "webai-whisper-tiny":   "Xenova/whisper-tiny.en",
  "webai-whisper-base":   "Xenova/whisper-base.en",
  "webai-whisper-small":  "Xenova/whisper-small.en",
  "webai-moonshine-tiny": "onnx-community/moonshine-tiny-ONNX",
  "webai-moonshine-base": "onnx-community/moonshine-base-ONNX",
}

const ENGINE_LABELS: Record<STTEngineId, string> = {
  "azure-speech":         "Azure Speech (cloud)",
  "groq-whisper":         "Groq Whisper (cloud)",
  "web-speech-api":       "Web Speech API",
  "webai-whisper-tiny":   "Whisper Tiny (offline)",
  "webai-whisper-base":   "Whisper Base (download required)",
  "webai-whisper-small":  "Whisper Small (download required)",
  "webai-moonshine-tiny": "Moonshine Tiny (download required)",
  "webai-moonshine-base": "Moonshine Base (download required)",
}

// Singleton pipeline cache so we don't reload the model between recordings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelineCache = new Map<string, any>()

export class TransformersEngine implements SpeechEngine {
  readonly name: string
  readonly isOffline = true

  private modelId: string
  private engineId: STTEngineId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transcriber: any = null
  private loading = false
  private loadError: string | null = null
  private permanentlyFailed = false
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private stream: MediaStream | null = null

  getStream(): MediaStream | null {
    return this.stream
  }

  constructor(engineId: STTEngineId) {
    this.engineId = engineId
    this.modelId = MODEL_MAP[engineId] ?? "Xenova/whisper-tiny.en"
    this.name = ENGINE_LABELS[engineId] ?? "Transformers"
  }

  isAvailable(): boolean {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined"
  }

  /** Warm up the model ahead of the first recording so transcription is snappy.
   *  No-ops if already loaded or previously failed. */
  async prepare(): Promise<void> {
    if (this.transcriber || this.permanentlyFailed) return
    await this.loadPipeline()
  }

  /** Test-only: run inference directly on a Float32Array PCM buffer (16 kHz mono).
   *  Used by the mic-test page to verify the model works without needing a mic. */
  async transcribeBuffer(audio: Float32Array): Promise<string> {
    const ok = await this.loadPipeline()
    if (!ok) throw new Error(this.loadError ?? "Model load failed")
    const result = await this.transcriber(audio)
    const text = typeof result === "string" ? result : (result?.text ?? "")
    return String(text).trim()
  }

  /** Detect WebGPU once. Transformers.js can use WebGPU OR WASM. */
  private async tryWebGPU(): Promise<boolean> {
    if (typeof navigator === "undefined") return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpu = (navigator as any).gpu
    if (!gpu) return false
    try {
      const adapter = await gpu.requestAdapter()
      return !!adapter
    } catch {
      return false
    }
  }

  private async loadPipeline(): Promise<boolean> {
    if (this.transcriber) return true
    if (this.permanentlyFailed) return false
    if (this.loading) {
      // wait for in-progress load
      return new Promise((resolve) => {
        const tick = setInterval(() => {
          if (!this.loading) {
            clearInterval(tick)
            resolve(!!this.transcriber)
          }
        }, 200)
        setTimeout(() => { clearInterval(tick); resolve(!!this.transcriber) }, 60000)
      })
    }

    // Reuse a cached pipeline for this model if we have one
    const cached = pipelineCache.get(this.modelId)
    if (cached) {
      this.transcriber = cached
      return true
    }

    this.loading = true
    this.loadError = null
    try {
      const { pipeline, env } = await import("@huggingface/transformers")

      // ── Offline-first runtime config ─────────────────────────────────────
      // Serve the ONNX-runtime WASM from the app's own /ort/ folder instead of
      // a CDN (with the proxy worker disabled), and load model weights from the
      // bundled /models/ folder. Shared with the Kokoro TTS engine, and waits
      // for the ORT backend so it's never skipped due to a load race.
      // Only the bundled tiny model is fully offline; the larger models are
      // download-on-demand, so allow remote ONLY for those (an explicit opt-in).
      const isBundledModel = this.engineId === "webai-whisper-tiny"
      await configureOrtEnv(env, { allowRemoteModels: !isBundledModel })

      // Detect Electron — its Chromium WebGPU is missing several subgroup
      // features that Transformers.js v4 expects (e.g. subgroupMinSize).
      // Force the WASM backend there to avoid runtime errors.
      const isElectron = typeof navigator !== "undefined" && /Electron\//i.test(navigator.userAgent)
      const useWebGPU = !isElectron && (await this.tryWebGPU())
      // Try the preferred device first, then fall back to WASM if it errors.
      const deviceCandidates: ("webgpu" | "wasm")[] = useWebGPU ? ["webgpu", "wasm"] : ["wasm"]

      let lastError: unknown = null
      for (const device of deviceCandidates) {
        try {
          console.log(`[Transformers] Loading ${this.modelId} on ${device} (${STT_DTYPE})...`)
          this.transcriber = await pipeline(
            "automatic-speech-recognition",
            this.modelId,
            // Fixed dtype so the exact ONNX weights we bundle are the ones
            // requested. ('q8'/_quantized uses MatMulNBits which this ORT build
            // can't load for Whisper; uint8 is plain QDQ and loads reliably.)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { device, dtype: STT_DTYPE } as any,
          )
          pipelineCache.set(this.modelId, this.transcriber)
          console.log(`[Transformers] Model ${this.modelId} ready (${device}).`)
          return true
        } catch (deviceErr) {
          lastError = deviceErr
          const msg = deviceErr instanceof Error ? deviceErr.message : String(deviceErr)
          console.warn(`[Transformers] ${device} backend failed:`, msg)
          // Common WebGPU pitfalls in older Chromium versions — fall through to WASM
          if (device === "webgpu" && (msg.includes("subgroupMinSize") || msg.includes("subgroup") || msg.includes("adapter"))) {
            console.log("[Transformers] Falling back to WASM backend...")
            continue
          }
          // For other errors, also try WASM as a last resort
          if (device !== "wasm") continue
          throw deviceErr
        }
      }
      throw lastError ?? new Error("All backends failed")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[Transformers] Failed to load ${this.modelId}:`, msg)
      this.loadError = `Failed to load ${this.modelId}: ${msg}. Try Web Speech API or check your connection.`
      this.permanentlyFailed = true
      return false
    } finally {
      this.loading = false
    }
  }

  async start(): Promise<void> {
    if (this.permanentlyFailed) {
      throw new Error(this.loadError ?? "Offline model unavailable.")
    }

    // Kick off model load in background (don't block mic capture)
    if (!this.transcriber && !this.loading) {
      this.loadPipeline().catch(() => { /* error stored in loadError */ })
    }

    this.audioChunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    })

    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data)
    }
    this.mediaRecorder.start(100)
  }

  async stop(): Promise<SpeechRecognitionResult> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        resolve({ transcript: "", confidence: 0 })
        return
      }

      this.mediaRecorder.onstop = async () => {
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop())
          this.stream = null
        }

        if (this.audioChunks.length === 0) {
          resolve({
            transcript: "",
            confidence: 0,
            errorCode: "no-speech",
            errorMessage: "No audio captured.",
          })
          return
        }

        try {
          // Wait for the model if it's still loading
          if (!this.transcriber) {
            const ok = await this.loadPipeline()
            if (!ok) {
              resolve({
                transcript: "",
                confidence: 0,
                errorCode: "model-load",
                errorMessage: this.loadError ?? "Model could not load.",
              })
              return
            }
          }

          // Decode the recorded webm/opus blob to 16 kHz mono Float32 PCM
          const blob = new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || "audio/webm",
          })
          this.audioChunks = []

          const arrayBuffer = await blob.arrayBuffer()
          const audioCtx = new AudioContext({ sampleRate: 16000 })
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
          // mono — Whisper expects [N] not [C, N]
          const float32 = audioBuffer.numberOfChannels > 1
            ? mixToMono(audioBuffer)
            : audioBuffer.getChannelData(0)
          audioCtx.close()

          // Silence gate (the SAME analyzeAudio used by the cloud engine):
          // Whisper invents text ("you", "thank you", …) on near-silent audio.
          // If the clip is silent/too short/too quiet, report no-speech BEFORE
          // inference so we never fabricate a word.
          const stats = analyzeAudio(float32, 16000)
          if (stats.isSilent) {
            resolve({
              transcript: "",
              confidence: 0,
              errorCode: "no-speech",
              errorMessage: "We didn't hear any speech. Move closer to the mic and speak clearly.",
            })
            return
          }

          // Run inference
          const result = await this.transcriber(float32)
          const text =
            typeof result === "string" ? result
            : result?.text ?? result?.transcription ?? ""
          const transcript = String(text).toLowerCase().trim()

          // Secondary guard (shared): drop Whisper's classic silence
          // hallucinations when the audio was quiet enough to be spurious, and
          // reject punctuation-only output ("." for silence).
          if (!hasRealSpeech(transcript) || isLikelyHallucination(transcript, stats.rms)) {
            resolve({
              transcript: "",
              confidence: 0,
              errorCode: "no-speech",
              errorMessage: "We didn't catch any clear speech. Please try again.",
            })
            return
          }

          resolve({ transcript, confidence: 0.85 })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn("[Transformers] Inference failed:", msg)
          resolve({
            transcript: "",
            confidence: 0,
            errorCode: "model-load",
            errorMessage: `Transcription failed: ${msg}`,
          })
        }
      }

      try { this.mediaRecorder.stop() } catch { /* ignore */ }
    })
  }
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const channels: Float32Array[] = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c))
  }
  const len = channels[0].length
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[i]
    out[i] = sum / channels.length
  }
  return out
}

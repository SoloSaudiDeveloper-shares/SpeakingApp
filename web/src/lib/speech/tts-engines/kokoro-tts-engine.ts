"use client"

import type { TtsEngine, TtsVoice, SpeakOptions } from "./types"
import { playPcm, stopPlayback } from "./audio-player"
import { configureOrtEnv } from "../configure-ort"

/**
 * Kokoro-82M neural TTS, running on the app's own @huggingface/transformers v4
 * (StyleTextToSpeech2) + the `phonemizer` package for English G2P. Reuses the
 * SAME offline ONNX runtime bundled in /public/ort and loads the model + voice
 * style vectors from /public/models — so it works with ZERO network, exactly
 * like the offline Whisper STT engine.
 *
 * Inference glue ported from kokoro-js: phonemize → tokenize → slice the voice
 * style vector by token length → StyleTextToSpeech2Model({input_ids, style,
 * speed}) → 24 kHz waveform.
 */

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"
// "q8" is transformers.js's wasm default and maps to onnx/model_quantized.onnx
// (the file we bundle). Keep in sync with scripts/fetch-tts-models.mjs.
const DTYPE = "q8"
const SAMPLE_RATE = 24000

/** Curated bundled voices (see scripts/fetch-tts-models.mjs). */
const VOICES: TtsVoice[] = [
  { id: "af_heart",    label: "Heart — US female",      accent: "American", gender: "female" },
  { id: "af_bella",    label: "Bella — US female",      accent: "American", gender: "female" },
  { id: "af_nicole",   label: "Nicole — US female",     accent: "American", gender: "female" },
  { id: "af_sarah",    label: "Sarah — US female",      accent: "American", gender: "female" },
  { id: "am_michael",  label: "Michael — US male",      accent: "American", gender: "male" },
  { id: "am_adam",     label: "Adam — US male",         accent: "American", gender: "male" },
  { id: "am_fenrir",   label: "Fenrir — US male",       accent: "American", gender: "male" },
  { id: "am_puck",     label: "Puck — US male",         accent: "American", gender: "male" },
  { id: "bf_emma",     label: "Emma — UK female",       accent: "British",  gender: "female" },
  { id: "bf_isabella", label: "Isabella — UK female",   accent: "British",  gender: "female" },
  { id: "bm_george",   label: "George — UK male",       accent: "British",  gender: "male" },
  { id: "bm_fable",    label: "Fable — UK male",         accent: "British",  gender: "male" },
]
const DEFAULT_VOICE = "af_heart"

// Module-level caches so the model loads once per session.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelPromise: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizerPromise: Promise<any> | null = null
const voiceCache = new Map<string, Float32Array>()
let loadError: string | null = null

async function configureEnv() {
  const { env } = await import("@huggingface/transformers")
  await configureOrtEnv(env)
}

export class KokoroTtsEngine implements TtsEngine {
  readonly id = "kokoro" as const
  readonly name = "Kokoro (offline)"
  readonly isOffline = true
  private speakGeneration = 0

  isAvailable(): boolean {
    return typeof window !== "undefined"
  }

  async listVoices(): Promise<TtsVoice[]> {
    return VOICES
  }

  async prepare(): Promise<void> {
    if (loadError) throw new Error(loadError)
    await this.load()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async load(): Promise<{ model: any; tokenizer: any; tf: any }> {
    await configureEnv()
    const tf = await import("@huggingface/transformers")
    if (!modelPromise) {
      modelPromise = tf.StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dtype: DTYPE, device: "wasm",
      } as any).catch((e: unknown) => {
        modelPromise = null
        loadError = e instanceof Error ? e.message : String(e)
        throw e
      })
    }
    if (!tokenizerPromise) {
      tokenizerPromise = tf.AutoTokenizer.from_pretrained(MODEL_ID)
    }
    const [model, tokenizer] = await Promise.all([modelPromise, tokenizerPromise])
    return { model, tokenizer, tf }
  }

  private async getVoiceVector(voiceId: string): Promise<Float32Array> {
    const cached = voiceCache.get(voiceId)
    if (cached) return cached
    // The BARE static path hits a Next/Turbopack dev quirk that returns an empty
    // 204 (the file is fine — a query string serves it correctly, and the query
    // is harmless in production). Without this the voice vector is empty and the
    // model throws "Tensor's size(256) does not match data length(0)".
    const res = await fetch(`/models/${MODEL_ID}/voices/${voiceId}.bin?v=1`)
    if (!res.ok) throw new Error(`Voice "${voiceId}" not bundled (HTTP ${res.status})`)
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) throw new Error(`Voice "${voiceId}" returned an empty body`)
    const data = new Float32Array(buf)
    voiceCache.set(voiceId, data)
    return data
  }

  /** Synthesize PCM (24 kHz mono) without playing — reusable for tests/saving. */
  async synthesize(text: string, voiceId: string, speed = 1): Promise<{ audio: Float32Array; sampleRate: number }> {
    const { model, tokenizer, tf } = await this.load()
    const { phonemize } = await import("phonemizer")

    const out = await phonemize(text, "en-us")
    const phonemes = Array.isArray(out) ? out.join(" ") : String(out)

    const { input_ids } = tokenizer(phonemes, { truncation: true })
    const numTokens = Number(input_ids.dims.at(-1))

    const voiceData = await this.getVoiceVector(voiceId)
    const offset = 256 * Math.min(Math.max(numTokens - 2, 0), 509)
    const styleData = voiceData.slice(offset, offset + 256)

    const style = new tf.Tensor("float32", styleData, [1, 256])
    const speedTensor = new tf.Tensor("float32", [speed], [1])
    const { waveform } = await model({ input_ids, style, speed: speedTensor })

    return { audio: waveform.data as Float32Array, sampleRate: SAMPLE_RATE }
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    const generation = ++this.speakGeneration
    if (opts?.signal?.aborted) throw opts.signal.reason
    const voiceId = opts?.voice && VOICES.some((v) => v.id === opts.voice) ? opts.voice : DEFAULT_VOICE
    // Kokoro takes a native speed input → adjust rate without pitch artifacts.
    const speed = Math.max(0.5, Math.min(2, opts?.rate ?? 1))
    const { audio, sampleRate } = await this.synthesize(text, voiceId, speed)
    if (generation !== this.speakGeneration) {
      throw new DOMException("Speech was superseded.", "AbortError")
    }
    if (opts?.signal?.aborted) throw opts.signal.reason
    await playPcm(audio, sampleRate, {
      volume: opts?.volume ?? 1,
      signal: opts?.signal,
    })
  }

  cancel(): void {
    this.speakGeneration += 1
    stopPlayback()
  }
}

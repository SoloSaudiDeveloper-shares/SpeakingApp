"use client"

import type { TtsEngine, TtsVoice, SpeakOptions } from "./types"
import { playBlob, stopPlayback } from "./audio-player"

/**
 * Piper neural TTS via @mintplex-labs/piper-tts-web (MIT). Fast, lightweight
 * CPU voices. The runtime wasm can be served locally (see PIPER_WASM_PATHS,
 * bundled in scripts/fetch-tts-models.mjs); the per-voice model (~20–60 MB)
 * downloads once from Hugging Face and is then cached in the browser's OPFS,
 * so it runs offline after first use. Kokoro is the fully-bundled default;
 * Piper is an optional alternative voice.
 */

const VOICES: TtsVoice[] = [
  { id: "en_US-hfc_female-medium", label: "HFC — US female", accent: "American", gender: "female" },
  { id: "en_US-amy-medium",        label: "Amy — US female",  accent: "American", gender: "female" },
  { id: "en_US-ryan-high",         label: "Ryan — US male",   accent: "American", gender: "male" },
  { id: "en_US-hfc_male-medium",   label: "HFC — US male",    accent: "American", gender: "male" },
  { id: "en_GB-alba-medium",       label: "Alba — UK female", accent: "British",  gender: "female" },
  { id: "en_GB-alan-medium",       label: "Alan — UK male",   accent: "British",  gender: "male" },
]
const DEFAULT_VOICE = "en_US-hfc_female-medium"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let session: any = null
let sessionVoice: string | null = null

export class PiperTtsEngine implements TtsEngine {
  readonly id = "piper" as const
  readonly name = "Piper (offline)"
  readonly isOffline = true
  private speakGeneration = 0

  isAvailable(): boolean {
    return typeof window !== "undefined"
  }

  async listVoices(): Promise<TtsVoice[]> {
    return VOICES
  }

  private async getSession(voiceId: string) {
    if (session && sessionVoice === voiceId) return session
    const { TtsSession } = await import("@mintplex-labs/piper-tts-web")
    session = await TtsSession.create({ voiceId })
    sessionVoice = voiceId
    return session
  }

  async prepare(): Promise<void> {
    // Explicit installation warms and caches the selected local model.
    await this.getSession(DEFAULT_VOICE)
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    const generation = ++this.speakGeneration
    if (opts?.signal?.aborted) throw opts.signal.reason
    const voiceId = opts?.voice && VOICES.some((v) => v.id === opts.voice) ? opts.voice : DEFAULT_VOICE
    const s = await this.getSession(voiceId)
    if (opts?.signal?.aborted) throw opts.signal.reason
    const blob: Blob = await s.predict(text)
    if (generation !== this.speakGeneration) {
      throw new DOMException("Speech was superseded.", "AbortError")
    }
    if (opts?.signal?.aborted) throw opts.signal.reason
    await playBlob(blob, {
      volume: opts?.volume ?? 1,
      rate: opts?.rate ?? 1,
      signal: opts?.signal,
    })
  }

  cancel(): void {
    this.speakGeneration += 1
    stopPlayback()
  }
}

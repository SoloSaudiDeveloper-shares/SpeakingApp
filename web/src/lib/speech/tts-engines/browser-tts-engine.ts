"use client"

import type { TtsEngine, TtsVoice, SpeakOptions } from "./types"

/**
 * Browser / OS text-to-speech via the Web Speech `speechSynthesis` API.
 * Always available, zero download, but voice quality varies by OS and the most
 * natural Windows voices require internet — which is why it is no longer the
 * default. Kept as a selectable fallback.
 */
export class BrowserTtsEngine implements TtsEngine {
  readonly id = "browser-tts" as const
  readonly name = "Browser / System voice"
  readonly isOffline = true

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis
  }

  listVoices(): Promise<TtsVoice[]> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) { resolve([]); return }
      const map = (vs: SpeechSynthesisVoice[]): TtsVoice[] =>
        vs.filter((v) => v.lang.toLowerCase().startsWith("en"))
          .map((v) => ({ id: v.name, label: `${v.name} (${v.lang})`, lang: v.lang }))
      const initial = window.speechSynthesis.getVoices()
      if (initial.length) { resolve(map(initial)); return }
      const handler = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", handler)
        resolve(map(window.speechSynthesis.getVoices()))
      }
      window.speechSynthesis.addEventListener("voiceschanged", handler)
      setTimeout(() => resolve(map(window.speechSynthesis.getVoices())), 1500)
    })
  }

  speak(text: string, opts?: SpeakOptions): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) { resolve(); return }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = "en-US"
      u.rate = Math.max(0.1, Math.min(2, opts?.rate ?? 1))
      u.volume = Math.max(0, Math.min(1, opts?.volume ?? 1))
      if (opts?.voice) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.name === opts.voice || v.voiceURI === opts.voice)
        if (voice) u.voice = voice
      }
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    })
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel()
  }
}

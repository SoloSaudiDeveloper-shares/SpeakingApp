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
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        reject(new Error("Browser speech synthesis is unavailable."))
        return
      }
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      let settled = false
      const cleanup = () => opts?.signal?.removeEventListener("abort", onAbort)
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const onAbort = () => {
        window.speechSynthesis.cancel()
        finish(() => reject(
          opts?.signal?.reason ?? new DOMException("Speech cancelled.", "AbortError"),
        ))
      }
      u.lang = "en-US"
      u.rate = Math.max(0.1, Math.min(2, opts?.rate ?? 1))
      u.volume = Math.max(0, Math.min(1, opts?.volume ?? 1))
      if (opts?.voice) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.name === opts.voice || v.voiceURI === opts.voice)
        if (voice) u.voice = voice
      }
      u.onend = () => finish(resolve)
      u.onerror = (event) => finish(() => reject(
        new Error(`Browser speech synthesis failed (${event.error || "unknown error"}).`),
      ))
      if (opts?.signal?.aborted) {
        onAbort()
        return
      }
      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      window.speechSynthesis.speak(u)
    })
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel()
  }
}

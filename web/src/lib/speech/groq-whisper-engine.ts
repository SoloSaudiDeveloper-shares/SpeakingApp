"use client"

import type { SpeechEngine, SpeechRecognitionResult, STTEngineId } from "./types"
import { TransformersEngine } from "./transformers-engine"
import { analyzeAudio, hasRealSpeech, isLikelyHallucination, type AudioStats } from "./audio-analysis"

/**
 * Default speech-to-text: Groq's hosted Whisper (whisper-large-v3-turbo) — fast
 * and accurate when online. Records audio locally, sends it to our server route
 * (which holds the Groq key), and on any failure falls back to the BUNDLED
 * offline Whisper model so recognition still works with no internet. When it
 * falls back, it fires a global `stt-fallback` event so the UI can show a toast.
 * The fallback can be disabled via the `stt_allow_offline_fallback` setting.
 */

const LOCAL_FALLBACK_ENGINE: STTEngineId = "webai-whisper-tiny" // bundled offline model

let fallbackAllowed: boolean | null = null
let fallbackFetchedAt = 0
async function isFallbackAllowed(): Promise<boolean> {
  const now = Date.now()
  if (fallbackAllowed !== null && now - fallbackFetchedAt < 30_000) return fallbackAllowed
  try {
    const s = await (await fetch("/api/settings")).json()
    fallbackAllowed = s.stt_allow_offline_fallback !== "false" // default ON
  } catch {
    fallbackAllowed = true
  }
  fallbackFetchedAt = now
  return fallbackAllowed
}

function emitFallback(reason: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("stt-fallback", { detail: { reason } }))
  }
}

async function decodeToPcm(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  let out: Float32Array
  if (audioBuffer.numberOfChannels > 1) {
    const len = audioBuffer.length
    const chans: Float32Array[] = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c))
    out = new Float32Array(len)
    for (let i = 0; i < len; i++) { let s = 0; for (const ch of chans) s += ch[i]; out[i] = s / chans.length }
  } else {
    out = audioBuffer.getChannelData(0)
  }
  ctx.close()
  return out
}

export class GroqWhisperEngine implements SpeechEngine {
  readonly name = "Groq Whisper (cloud)"
  readonly isOffline = false

  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private fallback: TransformersEngine | null = null

  getStream(): MediaStream | null {
    return this.stream
  }

  isAvailable(): boolean {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined"
  }

  async start(): Promise<void> {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    })
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data) }
    this.mediaRecorder.start(100)
  }

  async stop(): Promise<SpeechRecognitionResult> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        resolve({ transcript: "", confidence: 0 })
        return
      }
      this.mediaRecorder.onstop = async () => {
        if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
        if (this.chunks.length === 0) {
          resolve({ transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "No audio captured." })
          return
        }
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || "audio/webm" })
        this.chunks = []
        resolve(await this.transcribeBlob(blob))
      }
      try { this.mediaRecorder.stop() } catch { resolve({ transcript: "", confidence: 0 }) }
    })
  }

  /**
   * Transcribe a recorded audio blob: silence-gate → Groq cloud → offline
   * fallback. Public so the test harness can exercise the full path without a
   * microphone.
   */
  async transcribeBlob(blob: Blob): Promise<SpeechRecognitionResult> {
    // Decode once — used both for the silence gate and the offline fallback.
    let pcm: Float32Array | null = null
    try { pcm = await decodeToPcm(blob) } catch { /* let Groq try if decode fails */ }

    // ── Silence gate (shared with the offline engine) ─────────────────────
    // Never send silent/empty audio to Whisper: it hallucinates "thank you",
    // "you", etc. This is the definitive fix for the phantom-transcript bug.
    let stats: AudioStats | null = null
    if (pcm) {
      stats = analyzeAudio(pcm, 16000)
      if (stats.isSilent) {
        return {
          transcript: "", confidence: 0, errorCode: "no-speech",
          errorMessage: "We didn't hear any speech. Move closer to the mic and try again.",
        }
      }
    }

    // 1) Groq cloud transcription.
    try {
      const form = new FormData()
      form.append("file", blob, "audio.webm")
      const res = await fetch("/api/stt/transcribe", { method: "POST", body: form })
      if (res.ok) {
        const data = await res.json()
        const transcript = String(data.transcript ?? "").toLowerCase().trim()
        // Real word + not a known silence hallucination on quiet audio.
        if (transcript && hasRealSpeech(transcript) && !(stats && isLikelyHallucination(transcript, stats.rms))) {
          return { transcript, confidence: 0.95 }
        }
        return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "No speech detected. Try again, a little louder." }
      }
      // Non-2xx (no key / provider error) → fall through to offline fallback.
    } catch {
      // Network error (offline) → fall through to offline fallback.
    }

    // 2) Offline fallback to the bundled Whisper model (if allowed).
    if (!(await isFallbackAllowed())) {
      return {
        transcript: "", confidence: 0, errorCode: "network",
        errorMessage: "Cloud speech recognition is unavailable, and offline fallback is turned off.",
      }
    }
    try {
      if (!pcm) pcm = await decodeToPcm(blob)
      if (!this.fallback) this.fallback = new TransformersEngine(LOCAL_FALLBACK_ENGINE)
      const transcript = (await this.fallback.transcribeBuffer(pcm)).toLowerCase().trim()
      emitFallback("Cloud speech recognition was unavailable — used the offline voice model.")
      if (!hasRealSpeech(transcript) || (stats && isLikelyHallucination(transcript, stats.rms))) {
        return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "We didn't catch any clear speech." }
      }
      return { transcript, confidence: 0.8 }
    } catch (e) {
      return { transcript: "", confidence: 0, errorCode: "model-load", errorMessage: e instanceof Error ? e.message : String(e) }
    }
  }
}

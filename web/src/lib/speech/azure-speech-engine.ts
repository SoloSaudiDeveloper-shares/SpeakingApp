"use client"

import type { SpeechEngine, SpeechRecognitionResult, STTEngineId } from "./types"
import { TransformersEngine } from "./transformers-engine"
import { analyzeAudio, hasRealSpeech, isLikelyHallucination, type AudioStats } from "./audio-analysis"
import { decodeToPcm16k, pcmToWav } from "./audio-wav"

const LOCAL_FALLBACK_ENGINE: STTEngineId = "webai-whisper-tiny"

let fallbackAllowed: boolean | null = null
let fallbackFetchedAt = 0

async function isFallbackAllowed(): Promise<boolean> {
  const now = Date.now()
  if (fallbackAllowed !== null && now - fallbackFetchedAt < 30_000) return fallbackAllowed
  try {
    const s = await (await fetch("/api/settings")).json()
    fallbackAllowed = s.stt_allow_offline_fallback !== "false"
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

export class AzureSpeechEngine implements SpeechEngine {
  readonly name = "Azure Speech (cloud)"
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
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop())
          this.stream = null
        }
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

  async transcribeBlob(blob: Blob): Promise<SpeechRecognitionResult> {
    let pcm: Float32Array | null = null
    let stats: AudioStats | null = null

    try {
      pcm = await decodeToPcm16k(blob)
      stats = analyzeAudio(pcm, 16000)
      if (stats.isSilent) {
        return {
          transcript: "",
          confidence: 0,
          errorCode: "no-speech",
          errorMessage: "We didn't hear any speech. Move closer to the mic and try again.",
        }
      }
    } catch {
      return {
        transcript: "",
        confidence: 0,
        errorCode: "audio-capture",
        errorMessage: "We could not prepare the recording for Azure Speech.",
      }
    }

    try {
      const wav = pcmToWav(pcm, 16000)
      const form = new FormData()
      form.append("file", wav, "audio.wav")
      const res = await fetch("/api/stt/azure-transcribe", { method: "POST", body: form })
      if (res.ok) {
        const data = await res.json()
        const transcript = String(data.transcript ?? "").toLowerCase().trim()
        if (transcript && hasRealSpeech(transcript) && !(stats && isLikelyHallucination(transcript, stats.rms))) {
          return { transcript, confidence: Number(data.confidence ?? 0.9) || 0.9 }
        }
        return {
          transcript: "",
          confidence: 0,
          errorCode: "no-speech",
          errorMessage: "No clear speech detected. Try again, a little louder.",
        }
      }
    } catch {
      // Network/provider errors fall through to local fallback below.
    }

    if (!(await isFallbackAllowed())) {
      return {
        transcript: "",
        confidence: 0,
        errorCode: "network",
        errorMessage: "Azure Speech is unavailable, and offline fallback is turned off.",
      }
    }

    try {
      if (!this.fallback) this.fallback = new TransformersEngine(LOCAL_FALLBACK_ENGINE)
      const transcript = (await this.fallback.transcribeBuffer(pcm)).toLowerCase().trim()
      emitFallback("Azure Speech was unavailable - used the offline voice model.")
      if (!hasRealSpeech(transcript) || (stats && isLikelyHallucination(transcript, stats.rms))) {
        return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "We didn't catch any clear speech." }
      }
      return { transcript, confidence: 0.8 }
    } catch (e) {
      return { transcript: "", confidence: 0, errorCode: "model-load", errorMessage: e instanceof Error ? e.message : String(e) }
    }
  }
}

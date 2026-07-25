"use client"

import type { SpeechEngine, SpeechRecognitionResult, STTEngineId } from "./types"
import { TransformersEngine } from "./transformers-engine"
import { analyzeAudio, hasRealSpeech, isLikelyHallucination, type AudioStats } from "./audio-analysis"

const LOCAL_FALLBACK_ENGINE: STTEngineId = "webai-whisper-tiny"
const TARGET_RATE = 16000
const LONG_RECORDING_SECONDS = 45
const CHUNK_SECONDS = 30
const OVERLAP_SECONDS = 1

let fallbackAllowed: boolean | null = null
let fallbackFetchedAt = 0
async function isFallbackAllowed(): Promise<boolean> {
  const now = Date.now()
  if (fallbackAllowed !== null && now - fallbackFetchedAt < 30_000) return fallbackAllowed
  try {
    const settings = await (await fetch("/api/settings")).json()
    fallbackAllowed = settings.stt_allow_offline_fallback !== "false"
  } catch { fallbackAllowed = true }
  fallbackFetchedAt = now
  return fallbackAllowed
}

function emitFallback(reason: string) {
  window.dispatchEvent(new CustomEvent("stt-fallback", { detail: { reason } }))
}

async function decodeToMono16k(blob: Blob): Promise<{ pcm: Float32Array; duration: number }> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const mono = new Float32Array(decoded.length)
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel)
      for (let index = 0; index < mono.length; index++) mono[index] += samples[index] / decoded.numberOfChannels
    }
    if (decoded.sampleRate === TARGET_RATE) return { pcm: mono, duration: decoded.duration }
    const length = Math.max(1, Math.round(mono.length * TARGET_RATE / decoded.sampleRate))
    const resampled = new Float32Array(length)
    for (let index = 0; index < length; index++) {
      const source = index * decoded.sampleRate / TARGET_RATE
      const left = Math.floor(source)
      const right = Math.min(mono.length - 1, left + 1)
      const fraction = source - left
      resampled[index] = mono[left] * (1 - fraction) + mono[right] * fraction
    }
    return { pcm: resampled, duration: resampled.length / TARGET_RATE }
  } finally { await ctx.close() }
}

function pcmToWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE")
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, "data"); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: "audio/wav" })
}

type CloudResult = { transcript: string; words: Array<{ word: string; start: number; end: number }> }

async function cloudTranscribe(blob: Blob, filename: string): Promise<CloudResult> {
  const form = new FormData()
  form.append("file", blob, filename)
  const response = await fetch("/api/stt/transcribe", { method: "POST", body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.message || data?.detail || `Cloud transcription failed (${response.status}).`)
  return {
    transcript: String(data.transcript ?? "").trim(),
    words: Array.isArray(data.words) ? data.words.filter((word: { word?: unknown; start?: unknown; end?: unknown }) => typeof word.word === "string" && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end))).map((word: { word: string; start: number; end: number }) => ({ word: word.word.trim(), start: Number(word.start), end: Number(word.end) })) : [],
  }
}

async function cloudTranscribeWithRetry(blob: Blob, filename: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await cloudTranscribe(blob, filename) } catch (error) { lastError = error }
  }
  throw lastError
}

export class GroqWhisperEngine implements SpeechEngine {
  readonly name = "Groq Whisper (cloud)"
  readonly isOffline = false
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private fallback: TransformersEngine | null = null

  getStream() { return this.stream }
  isAvailable() { return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" }

  async start() {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: TARGET_RATE } })
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.chunks.push(event.data) }
    this.mediaRecorder.start(100)
  }

  async stop(): Promise<SpeechRecognitionResult> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return resolve({ transcript: "", confidence: 0 })
      const recorder = this.mediaRecorder
      recorder.onstop = async () => {
        this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" })
        this.chunks = []; this.mediaRecorder = null
        if (!blob.size) return resolve({ transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "No audio captured.", audioBlob: blob })
        resolve(await this.transcribeBlob(blob))
      }
      try { recorder.stop() } catch { resolve({ transcript: "", confidence: 0 }) }
    })
  }

  async transcribeBlob(blob: Blob): Promise<SpeechRecognitionResult> {
    let decoded: { pcm: Float32Array; duration: number } | null = null
    try { decoded = await decodeToMono16k(blob) } catch { /* cloud may still decode the original */ }
    let stats: AudioStats | null = null
    if (decoded) {
      stats = analyzeAudio(decoded.pcm, TARGET_RATE)
      if (stats.isSilent) return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "We didn't hear any speech. Move closer to the mic and try again.", audioBlob: blob, audioDurationSeconds: decoded.duration }
    }

    if (decoded && decoded.duration > LONG_RECORDING_SECONDS) {
      const step = (CHUNK_SECONDS - OVERLAP_SECONDS) * TARGET_RATE
      const chunkLength = CHUNK_SECONDS * TARGET_RATE
      const merged: Array<{ word: string; start: number; end: number }> = []
      for (let startSample = 0, chunkIndex = 0; startSample < decoded.pcm.length; startSample += step, chunkIndex++) {
        const endSample = Math.min(decoded.pcm.length, startSample + chunkLength)
        const chunk = pcmToWav(decoded.pcm.slice(startSample, endSample))
        try {
          const result = await cloudTranscribeWithRetry(chunk, `chunk-${chunkIndex + 1}.wav`)
          if (!result.words.length && result.transcript) throw new Error("Groq did not return word timestamps for a long-recording chunk.")
          const offset = startSample / TARGET_RATE
          for (const word of result.words) {
            if (chunkIndex > 0 && word.start < OVERLAP_SECONDS * 0.8) continue
            merged.push({ word: word.word, start: word.start + offset, end: word.end + offset })
          }
        } catch (error) {
          return { transcript: "", confidence: 0, errorCode: "network", errorMessage: `Chunk ${chunkIndex + 1} could not be transcribed after retry: ${error instanceof Error ? error.message : String(error)}`, audioBlob: blob, audioDurationSeconds: decoded.duration, partial: true }
        }
        if (endSample >= decoded.pcm.length) break
      }
      const transcript = merged.map((word) => word.word).join(" ").replace(/\s+([.,!?;:])/g, "$1").trim()
      return { transcript: transcript.toLowerCase(), confidence: transcript ? 0.95 : 0, wordTimings: merged, audioDurationSeconds: decoded.duration, audioBlob: blob, partial: false, ...(transcript ? {} : { errorCode: "no-speech" as const, errorMessage: "No speech detected." }) }
    }

    try {
      const cloud = await cloudTranscribe(blob, "audio.webm")
      const transcript = cloud.transcript.toLowerCase().trim()
      if (transcript && hasRealSpeech(transcript) && !(stats && isLikelyHallucination(transcript, stats.rms))) {
        return { transcript, confidence: 0.95, wordTimings: cloud.words, audioDurationSeconds: decoded?.duration, audioBlob: blob, partial: false }
      }
      return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "No speech detected. Try again, a little louder.", audioDurationSeconds: decoded?.duration, audioBlob: blob }
    } catch { /* fall through */ }

    if (!(await isFallbackAllowed())) return { transcript: "", confidence: 0, errorCode: "network", errorMessage: "Cloud speech recognition is unavailable, and offline fallback is turned off.", audioDurationSeconds: decoded?.duration, audioBlob: blob }
    try {
      if (!decoded) decoded = await decodeToMono16k(blob)
      if (!this.fallback) this.fallback = new TransformersEngine(LOCAL_FALLBACK_ENGINE)
      const transcript = (await this.fallback.transcribeBuffer(decoded.pcm)).toLowerCase().trim()
      emitFallback("Cloud speech recognition was unavailable — used the offline voice model.")
      if (!hasRealSpeech(transcript) || (stats && isLikelyHallucination(transcript, stats.rms))) return { transcript: "", confidence: 0, errorCode: "no-speech", errorMessage: "We didn't catch any clear speech.", audioDurationSeconds: decoded.duration, audioBlob: blob }
      return { transcript, confidence: 0.8, audioDurationSeconds: decoded.duration, audioBlob: blob, partial: false }
    } catch (error) {
      return { transcript: "", confidence: 0, errorCode: "model-load", errorMessage: error instanceof Error ? error.message : String(error), audioDurationSeconds: decoded?.duration, audioBlob: blob }
    }
  }
}

/**
 * Pure audio-energy analysis used to decide whether a recording actually
 * contains speech. This is the guard that prevents Whisper (cloud or local)
 * from hallucinating phrases like "thank you" / "you" on silent or empty
 * recordings — we simply never send silent audio to the transcriber.
 *
 * No DOM/Web Audio here so it can be unit-tested server-side with synthetic
 * buffers (see /api/dev/test-pipeline).
 */

export interface AudioStats {
  durationSec: number
  /** Root-mean-square amplitude over the whole clip. */
  rms: number
  /** Peak absolute amplitude. */
  peak: number
  /** Fraction of 20 ms frames whose energy clears the voiced floor. */
  voicedFraction: number
  /** True when the clip is effectively silent / too short to be real speech. */
  isSilent: boolean
}

const FRAME_MS = 20
const VOICED_RMS_FLOOR = 0.015

// Tuned so real speech (incl. quiet or non-native) clears every threshold,
// while empty/near-silent recordings are caught. Speech RMS is typically
// 0.02–0.2 and peak 0.1–0.6; silence is < 0.005 RMS and < 0.02 peak.
const MIN_DURATION_SEC = 0.25
const MIN_RMS = 0.006
const MIN_PEAK = 0.02
const MIN_VOICED_FRACTION = 0.04

/** True only if the transcript contains an actual word — not just punctuation.
 *  Whisper emits "." / "..." for silence, which must count as no-speech.
 *  Shared by every STT engine so the rule is identical everywhere. */
export function hasRealSpeech(t: string): boolean {
  return /[\p{L}\p{N}]/u.test(t)
}

/** Whisper's classic silence/noise hallucinations. When the audio was quiet, a
 *  transcript that is ONLY one of these is almost certainly fabricated — not a
 *  real answer. Kept here (not per-engine) so cloud + offline Whisper agree. */
export const HALLUCINATION_PHRASES = new Set([
  "you", "thank you", "thank you.", "thanks for watching!", "thanks for watching",
  "bye", "bye.", "bye bye", "bye-bye", ".", "...", "so", "uh", "um",
  "i'm sorry", "please subscribe", "subtitles by the amara.org community",
])

/** RMS ceiling below which a hallucination-phrase transcript is treated as
 *  no-speech. Real speech — even quiet, non-native — sits above this; pure
 *  silence/noise that slipped past the energy gate sits below it. */
export const HALLUCINATION_RMS_CEILING = 0.02

/** Whether a transcript is almost certainly a silence hallucination, given the
 *  clip's measured RMS. Fires ONLY for the known phrases AND only when the audio
 *  was too quiet to be real speech — so genuine short answers ("yes", "no", and
 *  even a deliberate "so") spoken at normal volume are never dropped. */
export function isLikelyHallucination(transcript: string, rms: number): boolean {
  const t = transcript.trim().toLowerCase()
  if (!t) return false
  return HALLUCINATION_PHRASES.has(t) && rms < HALLUCINATION_RMS_CEILING
}

export function analyzeAudio(buf: Float32Array, sampleRate: number): AudioStats {
  const n = buf.length
  const durationSec = sampleRate > 0 ? n / sampleRate : 0

  let sumSq = 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = buf[i]
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
    sumSq += v * v
  }
  const rms = n ? Math.sqrt(sumSq / n) : 0

  const frame = Math.max(1, Math.floor((sampleRate * FRAME_MS) / 1000))
  let voiced = 0
  let frames = 0
  for (let i = 0; i + frame <= n; i += frame) {
    let e = 0
    for (let j = 0; j < frame; j++) { const v = buf[i + j]; e += v * v }
    if (Math.sqrt(e / frame) > VOICED_RMS_FLOOR) voiced++
    frames++
  }
  const voicedFraction = frames ? voiced / frames : 0

  const isSilent =
    durationSec < MIN_DURATION_SEC ||
    rms < MIN_RMS ||
    peak < MIN_PEAK ||
    voicedFraction < MIN_VOICED_FRACTION

  return { durationSec, rms, peak, voicedFraction, isSilent }
}

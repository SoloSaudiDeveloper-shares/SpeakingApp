"use client"

import { assessFromAzureResponse, type AzureAssessment } from "@/lib/scoring/azure-pronunciation"
import type { CefrBand } from "@/lib/scoring/score-calculator"
import { decodeToPcm16k, pcmToWav } from "./audio-wav"

/**
 * Client helper for Azure Pronunciation Assessment. Decodes the recorded audio
 * to 16 kHz mono WAV (what the Azure REST endpoint expects), posts it with the
 * reference text, and maps the result. Returns null when Azure isn't configured
 * or the call fails — the caller then keeps the transcript-based scores.
 */

let configuredCache: boolean | null = null
let configuredAt = 0

/** Whether an Azure Speech key is configured (cached 60s). */
export async function isPronunciationConfigured(): Promise<boolean> {
  const now = Date.now()
  if (configuredCache !== null && now - configuredAt < 60_000) return configuredCache
  try {
    const res = await fetch("/api/pronunciation/status")
    const s = await res.json().catch(() => null)
    configuredCache = !!(res.ok && s?.configured)
  } catch {
    configuredCache = false
  }
  configuredAt = now
  return configuredCache
}

/** Azure heard no clear speech matching the reference (silence / wrong word /
 *  noise). The caller must treat this as a miss — NOT keep a transcript score. */
export const NO_SPEECH = Symbol("azure-no-speech")
export type AssessResult = AzureAssessment | typeof NO_SPEECH | null

/**
 * Returns:
 *   - an AzureAssessment when Azure scored the reference speech,
 *   - NO_SPEECH when Azure ran but heard no clear matching speech (the key fix:
 *     prevents a hallucinated transcript from scoring a perfect result),
 *   - null when Azure is unavailable (no key / network) → caller may fall back.
 */
export async function assessPronunciation(
  blob: Blob,
  referenceText: string,
  cefrBand: CefrBand,
  previousConsistency: number,
): Promise<AssessResult> {
  try {
    const pcm = await decodeToPcm16k(blob)
    const wav = pcmToWav(pcm, 16000)
    const form = new FormData()
    form.append("file", wav, "audio.wav")
    form.append("referenceText", referenceText)
    const res = await fetch("/api/pronunciation/assess", { method: "POST", body: form })
    if (!res.ok) return null // 503 not configured / 502 azure error → unavailable
    const azure = await res.json()
    const mapped = assessFromAzureResponse(azure, cefrBand, previousConsistency)
    if (mapped) return mapped
    // Call succeeded but no usable assessment → Azure recognized no clear speech.
    return NO_SPEECH
  } catch {
    return null
  }
}

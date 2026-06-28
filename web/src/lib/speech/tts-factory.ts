"use client"

import type { TtsEngine, TtsEngineId } from "./tts-engines/types"
import { BrowserTtsEngine } from "./tts-engines/browser-tts-engine"
import { KokoroTtsEngine } from "./tts-engines/kokoro-tts-engine"
import { PiperTtsEngine } from "./tts-engines/piper-tts-engine"

/**
 * The active TTS voice by default. Kokoro (bundled, offline, neural) is the
 * default so the app sounds production-grade out of the box; the Browser/System
 * voice and Piper remain selectable, but Browser starts deactivated.
 */
export const DEFAULT_TTS_ENGINE_ID: TtsEngineId = "kokoro"

const cache = new Map<TtsEngineId, TtsEngine>()
const failed = new Set<TtsEngineId>()

function create(id: TtsEngineId): TtsEngine {
  switch (id) {
    case "kokoro": return new KokoroTtsEngine()
    case "piper":  return new PiperTtsEngine()
    default:        return new BrowserTtsEngine()
  }
}

/** Get (and cache) a TTS engine by id. Falls back to the browser engine if a
 *  neural engine has been marked failed this session. */
export function getTtsEngine(id: TtsEngineId): TtsEngine {
  if (failed.has(id) && id !== "browser-tts") return getTtsEngine("browser-tts")
  const existing = cache.get(id)
  if (existing) return existing
  const engine = create(id)
  cache.set(id, engine)
  return engine
}

/** Mark an engine as broken (e.g. model failed to load) so we stop using it. */
export function markTtsEngineFailed(id: TtsEngineId) {
  failed.add(id)
}

export function getDefaultTtsEngine(): TtsEngine {
  return getTtsEngine(DEFAULT_TTS_ENGINE_ID)
}

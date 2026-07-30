"use client"

import type { TtsEngine, TtsEngineId } from "./tts-engines/types"
import { BrowserTtsEngine } from "./tts-engines/browser-tts-engine"

/**
 * The web runtime only owns the operating-system voice. Neural local speech is
 * served by the authenticated Windows companion and is never instantiated in
 * the production browser bundle.
 */
export const DEFAULT_TTS_ENGINE_ID: TtsEngineId = "browser-tts"

const cache = new Map<TtsEngineId, TtsEngine>()
const failed = new Set<TtsEngineId>()

function create(id: TtsEngineId): TtsEngine {
  void id
  return new BrowserTtsEngine()
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

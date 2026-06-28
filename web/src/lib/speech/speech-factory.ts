"use client"

import type { SpeechEngine, STTEngineId } from "./types";
import { WebSpeechEngine } from "./web-speech-engine";
import { TransformersEngine } from "./transformers-engine";
import { StreamingMoonshineEngine } from "./streaming-moonshine-engine";
import { GroqWhisperEngine } from "./groq-whisper-engine";
import { AzureSpeechEngine } from "./azure-speech-engine";

let currentEngine: SpeechEngine | null = null;
let currentEngineId: STTEngineId | null = null;

/** Track engines that are known to fail in this session, so we never recreate them. */
const failedEngines = new Set<STTEngineId>();

const OFFLINE_ENGINES: STTEngineId[] = [
  "webai-whisper-tiny",
  "webai-whisper-base",
  "webai-whisper-small",
  "webai-moonshine-tiny",
  "webai-moonshine-base",
];

/** Mark an engine as broken so we stop trying to create it again.
 *  If an offline engine fails, all offline engines are marked failed —
 *  they share the same runtime requirements. */
export function markEngineFailed(id: STTEngineId) {
  failedEngines.add(id);
  if (OFFLINE_ENGINES.includes(id)) {
    for (const e of OFFLINE_ENGINES) failedEngines.add(e);
  }
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null;
    if (saved && failedEngines.has(saved)) localStorage.removeItem("stt-engine");
  }
}

export function isEngineKnownFailed(id: STTEngineId): boolean {
  return failedEngines.has(id);
}

export function getFailedEngines(): Set<STTEngineId> {
  return new Set(failedEngines);
}

/**
 * Get or create a speech engine by ID.
 * Caches the engine instance for reuse.
 * If the engine is known to be broken, returns the Web Speech fallback instead.
 */
export function getSpeechEngine(engineId: STTEngineId): SpeechEngine {
  if (failedEngines.has(engineId)) {
    if (currentEngineId !== "web-speech-api") {
      currentEngine = new WebSpeechEngine();
      currentEngineId = "web-speech-api";
    }
    return currentEngine!;
  }

  if (currentEngine && currentEngineId === engineId) return currentEngine;

  if (engineId === "azure-speech") {
    currentEngine = new AzureSpeechEngine();
  } else if (engineId === "groq-whisper") {
    currentEngine = new GroqWhisperEngine();
  } else if (engineId === "web-speech-api") {
    currentEngine = new WebSpeechEngine();
  } else if (engineId === "webai-moonshine-tiny" || engineId === "webai-moonshine-base") {
    // Moonshine uses the streaming engine (Silero VAD + Moonshine in real-time)
    currentEngine = new StreamingMoonshineEngine(engineId);
  } else if (OFFLINE_ENGINES.includes(engineId)) {
    // Whisper engines remain batch-mode (transcribe-on-stop)
    currentEngine = new TransformersEngine(engineId);
  } else {
    currentEngine = new WebSpeechEngine();
  }

  currentEngineId = engineId;
  return currentEngine;
}

/** Default STT: Groq's hosted Whisper (fast + accurate online) with an automatic
 *  fall back to the BUNDLED offline Whisper when there's no internet. This gives
 *  the best of both: top accuracy when connected, and it still works in the
 *  packaged app offline. The fallback can be turned off in Settings. */
export const DEFAULT_ENGINE_ID: STTEngineId = "groq-whisper";

/** The offline engine the cloud default falls back to (and a standalone option). */
export const OFFLINE_DEFAULT_ENGINE_ID: STTEngineId = "webai-whisper-tiny";

const ALL_ENGINE_IDS: STTEngineId[] = [
  "azure-speech", "groq-whisper", "web-speech-api", "webai-whisper-tiny", "webai-whisper-base",
  "webai-whisper-small", "webai-moonshine-tiny", "webai-moonshine-base",
];

// The admin-configured default (active_stt_model), loaded once per session so
// the choice applies EVERYWHERE — practice, fluency drills, diagnostic, etc.
let configuredDefaultId: STTEngineId = DEFAULT_ENGINE_ID;
let configLoaded = false;

/** Load the admin's active_stt_model so getDefaultEngine() honours it app-wide.
 *  Call once early (it's invoked from ClientProviders). */
export async function loadConfiguredEngineId(): Promise<STTEngineId> {
  if (configLoaded) return configuredDefaultId;
  try {
    const s = await (await fetch("/api/settings")).json();
    const m = s.active_stt_model as STTEngineId | undefined;
    if (m && ALL_ENGINE_IDS.includes(m)) configuredDefaultId = m;
  } catch { /* keep the built-in default */ }
  configLoaded = true;
  return configuredDefaultId;
}

/**
 * Get the default engine — the admin-configured engine (active_stt_model),
 * defaulting to Groq cloud Whisper. Used by every recording surface so the
 * default is consistent across the whole app.
 */
export function getDefaultEngine(): SpeechEngine {
  return getSpeechEngine(configuredDefaultId);
}

/**
 * Text-to-speech with admin-configurable defaults and optional student override.
 *
 * Settings (from /api/settings):
 *   - tts_default_voice         — voice name selected by admin
 *   - tts_default_rate          — speech rate (0.5–2.0)
 *   - tts_default_pitch         — pitch (0.5–2.0)
 *   - tts_default_volume        — volume (0–1)
 *   - tts_allow_student_choice  — "true"/"false"
 *
 * If `tts_allow_student_choice === "true"`, the student's localStorage
 * picks (`tts-voice`, `tts-rate`, `tts-pitch`, `tts-volume`) override the
 * admin defaults. Otherwise the admin settings are forced.
 */

import { getTtsEngine, DEFAULT_TTS_ENGINE_ID } from './tts-factory';
import type { TtsEngineId } from './tts-engines/types';
import {
  cancelTtsProviderSpeech,
  speakWithTtsProviderFallback,
  TtsProviderPolicyUnavailableError,
} from './tts-provider-client';

export interface TtsSettings {
  voice: string | null;       // engine-specific voice id / name
  rate: number;
  pitch: number;
  volume: number;
}

let cachedAdminSettings: TtsSettings | null = null;
let cachedAllowChoice = false;
let cachedActiveEngine: TtsEngineId = DEFAULT_TTS_ENGINE_ID;
let lastFetched = 0;
const CACHE_MS = 30_000;

async function loadAdminSettings(): Promise<{ admin: TtsSettings; allowChoice: boolean }> {
  if (cachedAdminSettings && Date.now() - lastFetched < CACHE_MS) {
    return { admin: cachedAdminSettings, allowChoice: cachedAllowChoice };
  }
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const s = await res.json();
      cachedAdminSettings = {
        voice: s.tts_default_voice ?? null,
        rate: parseFloat(s.tts_default_rate ?? '0.9') || 0.9,
        pitch: parseFloat(s.tts_default_pitch ?? '1.0') || 1.0,
        volume: parseFloat(s.tts_default_volume ?? '1.0') || 1.0,
      };
      cachedAllowChoice = s.tts_allow_student_choice === 'true';
      // Legacy neural ids are normalized to the system engine. Production
      // neural speech is owned by the authenticated companion provider.
      cachedActiveEngine = s.active_tts_model === 'browser-tts'
        ? 'browser-tts'
        : DEFAULT_TTS_ENGINE_ID;
      lastFetched = Date.now();
    }
  } catch { /* ignore */ }
  return {
    admin: cachedAdminSettings ?? { voice: null, rate: 0.9, pitch: 1.0, volume: 1.0 },
    allowChoice: cachedAllowChoice,
  };
}

function readStudentOverride(): Partial<TtsSettings> {
  if (typeof window === 'undefined') return {};
  return {
    voice: localStorage.getItem('tts-voice') || undefined,
    rate: parseFloat(localStorage.getItem('tts-rate') ?? '') || undefined,
    pitch: parseFloat(localStorage.getItem('tts-pitch') ?? '') || undefined,
    volume: parseFloat(localStorage.getItem('tts-volume') ?? '') || undefined,
  };
}

/** Get the effective TTS settings (admin defaults, optionally overridden by student) */
export async function getEffectiveTtsSettings(): Promise<TtsSettings> {
  const { admin, allowChoice } = await loadAdminSettings();
  if (!allowChoice) return admin;
  const student = readStudentOverride();
  return {
    voice: student.voice ?? admin.voice,
    rate: student.rate ?? admin.rate,
    pitch: student.pitch ?? admin.pitch,
    volume: student.volume ?? admin.volume,
  };
}

/** Whether students are permitted to override the TTS defaults. */
export async function isStudentTtsChoiceAllowed(): Promise<boolean> {
  const { allowChoice } = await loadAdminSettings();
  return allowChoice;
}

/** Set a student's TTS override in localStorage (only effective if admin permits). */
export function setStudentTtsOverride(s: Partial<TtsSettings>) {
  if (typeof window === 'undefined') return;
  if (s.voice !== undefined) {
    if (s.voice) localStorage.setItem('tts-voice', s.voice);
    else localStorage.removeItem('tts-voice');
  }
  if (s.rate !== undefined) localStorage.setItem('tts-rate', String(s.rate));
  if (s.pitch !== undefined) localStorage.setItem('tts-pitch', String(s.pitch));
  if (s.volume !== undefined) localStorage.setItem('tts-volume', String(s.volume));
}

/** Force-refresh the admin settings cache (e.g. after the admin saves). */
export function invalidateTtsCache() {
  cachedAdminSettings = null;
  cachedAllowChoice = false;
  lastFetched = 0;
}

/** The legacy browser engine id. Neural local speech uses the companion policy. */
export async function getActiveTtsEngineId(): Promise<TtsEngineId> {
  await loadAdminSettings();
  return cachedActiveEngine;
}

/**
 * Fallback order for a given active engine. We prefer NEURAL voices — the
 * bundled, offline Kokoro is the reliable safety net for Piper (which downloads
 * its model from the network on first use and can fail when offline/blocked).
 * The Microsoft/system browser voice is ONLY an absolute last resort so the
 * student is never left in silence — it is never a silent default.
 */
function ttsFallbackChain(_active: TtsEngineId): TtsEngineId[] {
  return ['browser-tts'];
}

/** Fires when a neural engine failed and we had to use a fallback, so the UI can
 *  surface a toast instead of silently degrading to the system voice. */
function emitTtsFallback(from: TtsEngineId, to: TtsEngineId) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tts-fallback', { detail: { from, to } }));
  }
}

/**
 * Speak text using the active engine, walking the neural-first fallback chain on
 * failure. A failed utterance never SILENTLY lands on the Microsoft voice: it
 * tries the bundled Kokoro first, and only uses the system voice as a last
 * resort (emitting a `tts-fallback` event so it's visible, not mysterious).
 */
export async function speak(text: string, override?: Partial<TtsSettings>): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await speakWithTtsProviderFallback(text, {
      voice: override?.voice,
      rate: override?.rate,
      volume: override?.volume,
    });
    return;
  } catch (providerError) {
    if (!(providerError instanceof TtsProviderPolicyUnavailableError)) throw providerError;
    console.warn('[tts] provider policy unavailable; trying explicit legacy settings:', providerError);
  }
  const eff = await getEffectiveTtsSettings();
  const settings: TtsSettings = { ...eff, ...override };
  const engineId = await getActiveTtsEngineId();
  const opts = { voice: settings.voice, rate: settings.rate, volume: settings.volume };

  const chain = ttsFallbackChain(engineId);
  let lastErr: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    try {
      // The browser engine can't use neural voice ids → null lets it pick a
      // system voice; neural engines map an unknown id to their own default.
      await getTtsEngine(id).speak(text, id === 'browser-tts' ? { ...opts, voice: null } : opts);
      if (i > 0) emitTtsFallback(engineId, id);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[tts] engine "${id}" failed${i < chain.length - 1 ? ' — trying next' : ''}:`, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All text-to-speech engines failed.');
}

/** Stop any in-progress speech immediately. */
export function cancelSpeak(): void {
  if (typeof window === 'undefined') return;
  cancelTtsProviderSpeech();
  try { getTtsEngine(cachedActiveEngine).cancel(); } catch { /* ignore */ }
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

/** List browser voices (loads asynchronously the first time). */
export function listVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const initial = window.speechSynthesis.getVoices();
    if (initial.length > 0) {
      resolve(initial);
      return;
    }
    const handler = () => {
      const v = window.speechSynthesis.getVoices();
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve(v);
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    // Fallback timeout
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
  });
}

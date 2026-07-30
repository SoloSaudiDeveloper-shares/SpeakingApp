'use client';

import {
  parseTtsProviderPolicy,
  ttsProviderChain,
  TTS_PROVIDER_IDS,
  type DeviceTtsOverride,
  type TtsProviderId,
  type TtsProviderPolicy,
  type TtsProviderSelection,
} from './tts-policy';
import {
  fetchTtsAudioResponseWithDeadline,
  readTtsAudioResponse,
  type TtsBrowserStreamOutcome,
  type TtsBrowserStreamTelemetry,
} from './tts-audio-stream-client';
import { recordClientSpeechReliabilityEvent } from './reliability-client';

const DEVICE_DB_NAME = 'speaking-lab-device-settings';
const DEVICE_STORE_NAME = 'settings';
const DEVICE_OVERRIDE_KEY = 'tts-device-override-v1';
const POLICY_CACHE_KEY = 'tts-policy-cache-v1';
const POLICY_CACHE_MS = 30_000;
const PROVIDER_SET = new Set<string>(TTS_PROVIDER_IDS);
const CUSTOM_LOCAL_PORTS = new Set(['8000', '8880']);

export interface TtsProviderConfigResponse {
  policy: TtsProviderPolicy;
  source: 'policy' | 'legacy';
  readiness: Record<'azure-speech' | 'openai-tts', boolean>;
  effectiveUsage: Array<{
    provider: 'azure-speech' | 'openai-tts';
    periodMonth: string;
    characters: number;
    requestCount: number;
    cap: number;
    remaining: number;
  }>;
}

export interface LocalTtsHealth {
  ok: boolean;
  endpoint: string;
  latencyMs: number;
  detail?: string;
}

export interface WindowsCompanionPairingStatus {
  paired: boolean;
  endpoint: string | null;
  healthy?: boolean;
  latencyMs?: number;
  detail?: string;
  deviceId?: string;
}

export interface WindowsCompanionModelStatus {
  configured: boolean;
  installed: boolean;
  release: string | null;
  installing: boolean;
  phase: string;
  receivedBytes: number;
  expectedBytes: number;
}

export interface TtsFallbackEventDetail {
  from: TtsProviderId;
  to: TtsProviderId | null;
  reason: string;
}

export interface TtsPlaybackOverrides {
  voice?: string | null;
  rate?: number;
  volume?: number;
}

export class TtsProviderPolicyUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The organization voice policy is unavailable.', { cause });
  }
}

let activeAudio: HTMLAudioElement | null = null;
let activeAbort: AbortController | null = null;
let cachedConfiguration: TtsProviderConfigResponse | null = null;
let configurationFetchedAt = 0;

function openDeviceDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_STORE_NAME)) {
        request.result.createObjectStore(DEVICE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function parseLocalOrigin(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (hostname !== '127.0.0.1' && hostname !== 'localhost') ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Local TTS endpoints must be HTTP(S) loopback origins without a path.');
  }
  return url;
}

export function validateWindowsCompanionOrigin(value: string): string {
  const url = parseLocalOrigin(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '17841') {
    throw new Error('The Windows companion must use http://127.0.0.1:17841.');
  }
  return url.origin;
}

export function validateCustomLocalTtsOrigin(value: string): string {
  const url = parseLocalOrigin(value);
  if (!CUSTOM_LOCAL_PORTS.has(url.port)) {
    throw new Error('Custom local TTS must use approved user endpoint port 8000 or 8880.');
  }
  return url.origin;
}

export function resolveLocalTtsConnection(
  selection: TtsProviderSelection,
  device: DeviceTtsOverride | null,
): { origin: string; token?: string; responseFormat: 'wav' | 'mp3' } {
  if (selection.providerId === 'windows-companion') {
    if (!device?.companionEndpoint) {
      throw new Error('windows-companion is not configured on this device.');
    }
    if (!device.companionToken) {
      throw new Error('Pair this browser before using the Windows companion.');
    }
    return {
      origin: validateWindowsCompanionOrigin(device.companionEndpoint),
      token: optionalToken(device.companionToken),
      responseFormat: 'wav',
    };
  }
  if (selection.providerId === 'custom-local') {
    if (!device?.customLocalEndpoint) {
      throw new Error('custom-local is not configured on this device.');
    }
    return {
      origin: validateCustomLocalTtsOrigin(device.customLocalEndpoint),
      token: optionalToken(device.customLocalToken),
      responseFormat: 'mp3',
    };
  }
  throw new Error(`${selection.providerId} is not a loopback TTS provider.`);
}

function optionalToken(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 512) throw new Error('Device token is invalid.');
  return value;
}

function sanitizeSelection(value: unknown): TtsProviderSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Device TTS selection is invalid.');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.providerId !== 'string' || !PROVIDER_SET.has(input.providerId)) {
    throw new Error('Device TTS provider is invalid.');
  }
  if (input.providerId === 'browser-local') return undefined;
  const selection: TtsProviderSelection = { providerId: input.providerId as TtsProviderId };
  for (const key of ['modelId', 'voiceId'] as const) {
    const candidate = input[key];
    if (candidate !== undefined) {
      if (typeof candidate !== 'string' || candidate.length > 100) {
        throw new Error(`Device TTS ${key} is invalid.`);
      }
      selection[key] = candidate;
    }
  }
  return selection;
}

function sanitizeDeviceOverride(value: unknown): DeviceTtsOverride {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    selection: sanitizeSelection(input.selection),
    companionEndpoint: typeof input.companionEndpoint === 'string'
      ? validateWindowsCompanionOrigin(input.companionEndpoint)
      : undefined,
    companionToken: optionalToken(input.companionToken),
    customLocalEndpoint: typeof input.customLocalEndpoint === 'string'
      ? validateCustomLocalTtsOrigin(input.customLocalEndpoint)
      : undefined,
    customLocalToken: optionalToken(input.customLocalToken),
  };
}

export async function getDeviceTtsOverride(): Promise<DeviceTtsOverride | null> {
  const db = await openDeviceDb();
  if (!db) return null;
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(DEVICE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(DEVICE_STORE_NAME).get(DEVICE_OVERRIDE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value ? sanitizeDeviceOverride(value) : null;
  } finally {
    db.close();
  }
}

export async function setDeviceTtsOverride(value: DeviceTtsOverride): Promise<DeviceTtsOverride> {
  const sanitized = sanitizeDeviceOverride(value);
  const db = await openDeviceDb();
  if (!db) throw new Error('This browser does not support device TTS settings.');
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite');
      transaction.objectStore(DEVICE_STORE_NAME).put(sanitized, DEVICE_OVERRIDE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return sanitized;
  } finally {
    db.close();
  }
}

export async function clearDeviceTtsOverride(): Promise<void> {
  const db = await openDeviceDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DEVICE_STORE_NAME, 'readwrite');
      transaction.objectStore(DEVICE_STORE_NAME).delete(DEVICE_OVERRIDE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function probeLocalTtsEndpoint(endpoint: string, token?: string): Promise<LocalTtsHealth> {
  let origin: string;
  let isCompanion = false;
  try {
    origin = validateWindowsCompanionOrigin(endpoint);
    isCompanion = true;
  } catch {
    origin = validateCustomLocalTtsOrigin(endpoint);
  }
  if (isCompanion && !token) {
    throw new Error('Pair this browser before connecting to the Windows companion.');
  }
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${origin}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      endpoint: origin,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: origin,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : 'Connection failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function pairWindowsCompanion(
  endpoint: string,
  code: string,
): Promise<{ paired: true; endpoint: string; deviceId?: string }> {
  const origin = validateWindowsCompanionOrigin(endpoint);
  if (!/^\d{6}$/.test(code)) throw new Error('Pairing code must contain exactly six digits.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${origin}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Companion pairing failed (${response.status}).`);
    const result = await response.json() as { token?: unknown; deviceId?: unknown };
    if (typeof result.token !== 'string' || result.token.length < 32 || result.token.length > 512) {
      throw new Error('Companion returned an invalid pairing token.');
    }
    const current = await getDeviceTtsOverride() ?? {};
    await setDeviceTtsOverride({
      ...current,
      companionEndpoint: origin,
      companionToken: result.token,
    });
    return {
      paired: true,
      endpoint: origin,
      deviceId: typeof result.deviceId === 'string' ? result.deviceId.slice(0, 120) : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function unpairWindowsCompanion(
  endpoint: string,
  token: string,
): Promise<void> {
  const origin = validateWindowsCompanionOrigin(endpoint);
  if (!token) throw new Error('This browser is not paired with the Windows companion.');
  const response = await fetch(`${origin}/unpair`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Companion unpairing failed (${response.status}).`);
  }
  const current = await getDeviceTtsOverride() ?? {};
  await setDeviceTtsOverride({
    ...current,
    companionEndpoint: origin,
    companionToken: undefined,
  });
}

export async function getWindowsCompanionPairingStatus(
  probe = false,
): Promise<WindowsCompanionPairingStatus> {
  const device = await getDeviceTtsOverride();
  if (!device?.companionEndpoint || !device.companionToken) {
    return { paired: false, endpoint: device?.companionEndpoint ?? null };
  }
  if (!probe) return { paired: true, endpoint: device.companionEndpoint };
  const health = await probeLocalTtsEndpoint(device.companionEndpoint, device.companionToken);
  return {
    paired: true,
    endpoint: device.companionEndpoint,
    healthy: health.ok,
    latencyMs: health.latencyMs,
    detail: health.detail,
  };
}

export async function getWindowsCompanionModelStatus(
  endpoint: string,
  token: string,
): Promise<WindowsCompanionModelStatus> {
  const origin = validateWindowsCompanionOrigin(endpoint);
  if (!token) throw new Error('Pair this browser before checking local models.');
  const response = await fetch(`${origin}/v1/models/install/status`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Companion model status failed (${response.status}).`);
  }
  const body = await response.json() as Partial<WindowsCompanionModelStatus>;
  return {
    configured: body.configured === true,
    installed: body.installed === true,
    release: typeof body.release === 'string' ? body.release.slice(0, 64) : null,
    installing: body.installing === true,
    phase: typeof body.phase === 'string' ? body.phase.slice(0, 64) : 'idle',
    receivedBytes: Number.isSafeInteger(body.receivedBytes) && Number(body.receivedBytes) >= 0
      ? Number(body.receivedBytes)
      : 0,
    expectedBytes: Number.isSafeInteger(body.expectedBytes) && Number(body.expectedBytes) >= 0
      ? Number(body.expectedBytes)
      : 0,
  };
}

export async function installWindowsCompanionModel(
  endpoint: string,
  token: string,
  authorizationCode: string,
  signal?: AbortSignal,
): Promise<WindowsCompanionModelStatus> {
  const origin = validateWindowsCompanionOrigin(endpoint);
  if (!token) throw new Error('Pair this browser before installing local models.');
  if (!/^\d{6}$/.test(authorizationCode)) {
    throw new Error('The model installation code must contain exactly six digits.');
  }
  const response = await fetch(`${origin}/v1/models/install`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: authorizationCode }),
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `Companion model installation failed (${response.status}).`);
  }
  const body = await response.json() as { installed?: unknown; release?: unknown };
  return {
    configured: true,
    installed: body.installed === true,
    release: typeof body.release === 'string' ? body.release.slice(0, 64) : null,
    installing: false,
    phase: body.installed === true ? 'installed' : 'failed',
    receivedBytes: 0,
    expectedBytes: 0,
  };
}

function parseConfiguration(value: Partial<TtsProviderConfigResponse>): TtsProviderConfigResponse {
  if (value.source !== 'policy' && value.source !== 'legacy') {
    throw new Error('Voice configuration response is invalid.');
  }
  return {
    policy: parseTtsProviderPolicy(value.policy),
    source: value.source,
    readiness: value.readiness ?? { 'azure-speech': false, 'openai-tts': false },
    effectiveUsage: value.effectiveUsage ?? [],
  };
}

export function invalidateTtsProviderConfigCache(): void {
  cachedConfiguration = null;
  configurationFetchedAt = 0;
  try {
    localStorage.removeItem(POLICY_CACHE_KEY);
  } catch {
    // Storage can be blocked in hardened/private browser profiles.
  }
}

export async function fetchTtsProviderConfig(force = false): Promise<TtsProviderConfigResponse> {
  if (!force && cachedConfiguration && Date.now() - configurationFetchedAt < POLICY_CACHE_MS) {
    return cachedConfiguration;
  }
  try {
    const response = await fetch('/api/tts/config', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Voice configuration is unavailable.');
    const configuration = parseConfiguration(
      await response.json() as Partial<TtsProviderConfigResponse>,
    );
    cachedConfiguration = configuration;
    configurationFetchedAt = Date.now();
    try {
      localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(configuration));
    } catch {
      // The in-memory cache remains available when persistent storage is blocked.
    }
    return configuration;
  } catch (error) {
    try {
      const cached = localStorage.getItem(POLICY_CACHE_KEY);
      if (cached) {
        const configuration = parseConfiguration(JSON.parse(cached));
        cachedConfiguration = configuration;
        configurationFetchedAt = Date.now();
        return configuration;
      }
    } catch {
      // A corrupt last-known policy must not be used.
    }
    throw error;
  }
}

function playAudioBlob(blob: Blob, volume: number, signal?: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = volume;
  activeAudio = audio;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
    };
    const onAbort = () => {
      audio.pause();
      audio.src = '';
      cleanup();
      reject(signal?.reason ?? new DOMException('Speech cancelled.', 'AbortError'));
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('The synthesized audio could not be played.'));
    };
    audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function recordTtsBrowserStreamTelemetry(
  telemetry: TtsBrowserStreamTelemetry,
): void {
  recordClientSpeechReliabilityEvent({
    eventType: 'tts',
    provider: telemetry.provider,
    route: 'tts-browser-audio-stream',
    success: telemetry.outcome === 'completed',
    errorCode: telemetry.outcome === 'completed' ? null : telemetry.outcome,
    latencyMs: telemetry.totalMs,
    metadata: {
      audio_bytes: telemetry.audioBytes,
      ttfb_ms: telemetry.ttfbMs,
      total_ms: telemetry.totalMs,
      stream_outcome: telemetry.outcome,
    },
  });
}

function recordTtsBrowserFetchOutcome(
  provider: TtsProviderId,
  outcome: Extract<
    TtsBrowserStreamOutcome,
    'cancelled' | 'http-error' | 'invalid-response' | 'network-error'
  >,
  requestStartedAt: number,
  responseReceivedAt = Date.now(),
): void {
  recordTtsBrowserStreamTelemetry({
    provider,
    outcome,
    ttfbMs: Math.max(0, responseReceivedAt - requestStartedAt),
    totalMs: Math.max(0, Date.now() - requestStartedAt),
    audioBytes: 0,
  });
}

async function executeProvider(
  selection: TtsProviderSelection,
  policy: TtsProviderPolicy,
  device: DeviceTtsOverride | null,
  text: string,
  playback: TtsPlaybackOverrides,
  signal: AbortSignal,
): Promise<void> {
  const definition = policy.providers[selection.providerId];
  const modelId = selection.modelId ?? definition.modelId;
  const voiceId = playback.voice ?? selection.voiceId ?? definition.voiceId;
  const localRate = playback.rate ?? policy.rate;
  const volume = playback.volume ?? policy.volume;
  if (selection.providerId === 'browser-local') {
    throw new Error('Browser-local neural speech is not available in production.');
  }
  if (selection.providerId === 'browser-system') {
    const [{ getTtsEngine }] = await Promise.all([import('./tts-factory')]);
    if (signal.aborted) throw signal.reason;
    await getTtsEngine('browser-tts').speak(text, {
      voice: null,
      rate: localRate,
      volume,
      signal,
    });
    return;
  }
  if (selection.providerId === 'azure-speech' || selection.providerId === 'openai-tts') {
    const requestStartedAt = Date.now();
    const { response, responseReceivedAt } = await fetchTtsAudioResponseWithDeadline(
      '/api/tts/speech',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selection.providerId,
          input: text,
          voiceId: policy.allowStudentVoiceChoice ? voiceId : undefined,
        }),
      },
      {
        provider: selection.providerId,
        requestStartedAt,
        signal,
        onTelemetry: recordTtsBrowserStreamTelemetry,
      },
    );
    if (!response.ok) {
      recordTtsBrowserFetchOutcome(
        selection.providerId,
        'http-error',
        requestStartedAt,
        responseReceivedAt,
      );
      throw new Error(`${selection.providerId} failed (${response.status}).`);
    }
    if (!(response.headers.get('content-type') ?? '').match(/^audio\//i)) {
      recordTtsBrowserFetchOutcome(
        selection.providerId,
        'invalid-response',
        requestStartedAt,
        responseReceivedAt,
      );
      throw new Error(`${selection.providerId} returned an invalid audio response.`);
    }
    const audio = await readTtsAudioResponse(response, {
      provider: selection.providerId,
      requestStartedAt,
      responseReceivedAt,
      signal,
      onTelemetry: recordTtsBrowserStreamTelemetry,
    });
    await playAudioBlob(audio, volume, signal);
    return;
  }

  const connection = resolveLocalTtsConnection(selection, device);
  const requestStartedAt = Date.now();
  const { response, responseReceivedAt } = await fetchTtsAudioResponseWithDeadline(
    `${connection.origin}/v1/audio/speech`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        voice: voiceId || undefined,
        input: text,
        response_format: connection.responseFormat,
        speed: policy.rate,
      }),
      redirect: 'error',
    },
    {
      provider: selection.providerId,
      requestStartedAt,
      signal,
      onTelemetry: recordTtsBrowserStreamTelemetry,
    },
  );
  if (!response.ok) {
    recordTtsBrowserFetchOutcome(
      selection.providerId,
      'http-error',
      requestStartedAt,
      responseReceivedAt,
    );
    throw new Error(`${selection.providerId} failed (${response.status}).`);
  }
  if (!(response.headers.get('content-type') ?? '').match(/^audio\//i)) {
    recordTtsBrowserFetchOutcome(
      selection.providerId,
      'invalid-response',
      requestStartedAt,
      responseReceivedAt,
    );
    throw new Error(`${selection.providerId} returned an invalid audio response.`);
  }
  const audio = await readTtsAudioResponse(response, {
    provider: selection.providerId,
    requestStartedAt,
    responseReceivedAt,
    signal,
    onTelemetry: recordTtsBrowserStreamTelemetry,
  });
  await playAudioBlob(audio, volume, signal);
}

function emitFallback(detail: TtsFallbackEventDetail) {
  window.dispatchEvent(new CustomEvent<TtsFallbackEventDetail>('tts-provider-fallback', { detail }));
  window.dispatchEvent(new CustomEvent('tts-fallback', {
    detail: { from: detail.from, to: detail.to, reason: detail.reason },
  }));
}

export function cancelTtsProviderSpeech(): void {
  activeAbort?.abort(new DOMException('Speech cancelled.', 'AbortError'));
  activeAbort = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio = null;
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Cancellation is best effort across browser engines.
  }
}

function legacyStudentPlayback(policy: TtsProviderPolicy): TtsPlaybackOverrides {
  if (!policy.allowStudentVoiceChoice) return {};
  const numeric = (key: string, min: number, max: number) => {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  };
  return {
    voice: localStorage.getItem('tts-voice') || undefined,
    rate: numeric('tts-rate', 0.5, 2),
    volume: numeric('tts-volume', 0, 1),
  };
}

export async function speakWithTtsProviderFallback(
  text: string,
  overrides: TtsPlaybackOverrides = {},
): Promise<TtsProviderSelection> {
  const normalizedText = text.trim();
  if (!normalizedText) throw new Error('Text is required for speech synthesis.');
  if (Array.from(normalizedText).length > 1_000) {
    throw new Error('Text-to-speech input cannot exceed 1,000 characters.');
  }
  cancelTtsProviderSpeech();
  const controller = new AbortController();
  activeAbort = controller;
  let configuration: TtsProviderConfigResponse;
  try {
    configuration = await fetchTtsProviderConfig();
  } catch (error) {
    throw new TtsProviderPolicyUnavailableError(error);
  }
  const device = await getDeviceTtsOverride().catch(() => null);
  const chain = ttsProviderChain(configuration.policy, device);
  const playback = {
    ...legacyStudentPlayback(configuration.policy),
    ...overrides,
  };
  const failures: Error[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const selection = chain[index];
    if (
      (selection.providerId === 'azure-speech' || selection.providerId === 'openai-tts') &&
      !configuration.readiness[selection.providerId]
    ) {
      failures.push(new Error(`${selection.providerId} is not configured.`));
      continue;
    }
    try {
      await executeProvider(
        selection,
        configuration.policy,
        device,
        normalizedText,
        playback,
        controller.signal,
      );
      if (index > 0) {
        emitFallback({
          from: chain[0].providerId,
          to: selection.providerId,
          reason: failures.at(-1)?.message ?? 'The preferred provider was unavailable.',
        });
      }
      if (activeAbort === controller) activeAbort = null;
      return selection;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  emitFallback({
    from: chain[0]?.providerId ?? 'windows-companion',
    to: null,
    reason: failures.at(-1)?.message ?? 'No TTS provider is available.',
  });
  if (activeAbort === controller) activeAbort = null;
  throw new AggregateError(failures, 'All configured text-to-speech providers failed.');
}

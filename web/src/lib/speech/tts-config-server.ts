import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { getSecretStore } from '@/lib/secrets/secret-store';
import {
  migrateLegacyTtsSettings,
  parseTtsProviderPolicy,
  type CloudTtsProviderId,
  type TtsProviderPolicy,
} from './tts-policy';

const POLICY_SETTING_KEY = 'tts_provider_policy_v1';
const LEGACY_KEYS = [
  'active_tts_model',
  'tts_default_voice',
  'tts_default_rate',
  'tts_default_volume',
  'tts_auto_play',
  'tts_repeat_count',
  'tts_allow_student_choice',
] as const;

export class TtsConfigConflictError extends Error {
  constructor(public readonly current: TtsProviderPolicy) {
    super('TTS configuration was changed by another administrator.');
  }
}

async function readPersistedPolicy(): Promise<{ policy: TtsProviderPolicy; raw: string } | null> {
  const row = (await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, POLICY_SETTING_KEY))
    .limit(1))[0];
  if (!row) return null;
  return { policy: parseTtsProviderPolicy(JSON.parse(row.value)), raw: row.value };
}

async function readLegacyPolicy(): Promise<TtsProviderPolicy> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, [...LEGACY_KEYS]));
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return migrateLegacyTtsSettings(values);
}

export async function getTtsProviderPolicy(): Promise<{
  policy: TtsProviderPolicy;
  source: 'policy' | 'legacy';
}> {
  const persisted = await readPersistedPolicy();
  if (persisted) return { policy: persisted.policy, source: 'policy' };
  return { policy: await readLegacyPolicy(), source: 'legacy' };
}

export async function saveTtsProviderPolicy(
  expectedVersion: number,
  input: unknown,
): Promise<TtsProviderPolicy> {
  const requested = parseTtsProviderPolicy(input);
  if (requested.version !== expectedVersion) {
    throw new Error('TTS policy version does not match expectedVersion.');
  }
  const readiness = await getCloudTtsReadiness();
  for (const providerId of ['azure-speech', 'openai-tts'] as const) {
    const provider = requested.providers[providerId];
    if (!provider.enabled) continue;
    if (provider.monthlyCharacterCap <= 0) {
      throw new Error(`${providerId} requires a positive monthly character cap before it can be enabled.`);
    }
    if (!readiness[providerId]) {
      throw new Error(`${providerId} requires a configured API credential before it can be enabled.`);
    }
  }
  const persisted = await readPersistedPolicy();

  if (persisted) {
    if (persisted.policy.version !== expectedVersion) {
      throw new TtsConfigConflictError(persisted.policy);
    }
    const next = { ...requested, version: expectedVersion + 1 };
    const nextRaw = JSON.stringify(next);
    const updated = await db
      .update(appSettings)
      .set({ value: nextRaw })
      .where(and(eq(appSettings.key, POLICY_SETTING_KEY), eq(appSettings.value, persisted.raw)))
      .returning({ value: appSettings.value });
    if (updated.length === 0) {
      const current = await readPersistedPolicy();
      throw new TtsConfigConflictError(current?.policy ?? await readLegacyPolicy());
    }
    return next;
  }

  const legacy = await readLegacyPolicy();
  if (expectedVersion !== legacy.version) throw new TtsConfigConflictError(legacy);
  const next = { ...requested, version: expectedVersion + 1 };
  const inserted = await db
    .insert(appSettings)
    .values({ key: POLICY_SETTING_KEY, value: JSON.stringify(next) })
    .onConflictDoNothing({ target: appSettings.key })
    .returning({ value: appSettings.value });
  if (inserted.length === 0) {
    const current = await readPersistedPolicy();
    throw new TtsConfigConflictError(current?.policy ?? legacy);
  }
  return next;
}

export async function getCloudTtsReadiness(): Promise<Record<CloudTtsProviderId, boolean>> {
  const secrets = getSecretStore();
  const [azure, openai] = await Promise.all([
    secrets.configured('azure_speech_key'),
    secrets.configured('openai_api_key'),
  ]);
  return { 'azure-speech': azure, 'openai-tts': openai };
}

export async function getCloudTtsSecret(providerId: CloudTtsProviderId): Promise<string | null> {
  return getSecretStore().get(providerId === 'azure-speech' ? 'azure_speech_key' : 'openai_api_key');
}

export async function getAzureSpeechRegion(): Promise<string> {
  const row = (await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, 'azure_speech_region'))
    .limit(1))[0];
  const region = row?.value.trim().toLowerCase() || 'eastus';
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw new Error('Azure Speech region is invalid.');
  return region;
}

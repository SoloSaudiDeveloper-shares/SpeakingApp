export const TTS_PROVIDER_IDS = [
  'browser-local',
  'windows-companion',
  'custom-local',
  'azure-speech',
  'openai-tts',
  'browser-system',
] as const;

export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];
export type CloudTtsProviderId = Extract<TtsProviderId, 'azure-speech' | 'openai-tts'>;

export interface TtsProviderSelection {
  providerId: TtsProviderId;
  modelId?: string;
  voiceId?: string;
}

export interface TtsProviderDefinition {
  enabled: boolean;
  modelId: string;
  voiceId: string;
  allowedVoiceIds: string[];
  monthlyCharacterCap: number;
}

export interface TtsProviderPolicy {
  version: number;
  organizationDefault: TtsProviderSelection;
  fallbacks: TtsProviderSelection[];
  allowDeviceOverrides: boolean;
  allowStudentVoiceChoice: boolean;
  rate: number;
  volume: number;
  autoPlay: boolean;
  repeatCount: number;
  providers: Record<TtsProviderId, TtsProviderDefinition>;
}

export interface DeviceTtsOverride {
  selection?: TtsProviderSelection;
  companionEndpoint?: string;
  companionToken?: string;
  customLocalEndpoint?: string;
  customLocalToken?: string;
}

export interface LegacyTtsSettings {
  active_tts_model?: string | null;
  tts_default_voice?: string | null;
  tts_default_rate?: string | null;
  tts_default_volume?: string | null;
  tts_auto_play?: string | null;
  tts_repeat_count?: string | null;
  tts_allow_student_choice?: string | null;
}

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

export const KOKORO_TTS_VOICES = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sarah',
  'am_michael',
  'am_adam',
  'am_fenrir',
  'am_puck',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_fable',
] as const;

const OPENAI_TTS_MODELS = new Set(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']);
const KOKORO_VOICE_SET = new Set<string>(KOKORO_TTS_VOICES);
const PROVIDER_SET = new Set<string>(TTS_PROVIDER_IDS);
const AZURE_VOICE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;

export function createDefaultTtsProviderPolicy(): TtsProviderPolicy {
  return {
    version: 1,
    organizationDefault: {
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: 'af_heart',
    },
    fallbacks: [
      { providerId: 'azure-speech', modelId: 'standard', voiceId: 'en-US-JennyNeural' },
      { providerId: 'openai-tts', modelId: 'gpt-4o-mini-tts', voiceId: 'alloy' },
      { providerId: 'browser-system' },
    ],
    allowDeviceOverrides: false,
    allowStudentVoiceChoice: false,
    rate: 0.9,
    volume: 1,
    autoPlay: true,
    repeatCount: 1,
    providers: {
      'browser-local': {
        enabled: false,
        modelId: '',
        voiceId: '',
        allowedVoiceIds: [],
        monthlyCharacterCap: 0,
      },
      'windows-companion': {
        enabled: true,
        modelId: 'kokoro',
        voiceId: 'af_heart',
        allowedVoiceIds: [...KOKORO_TTS_VOICES],
        monthlyCharacterCap: 0,
      },
      'custom-local': {
        enabled: false,
        modelId: '',
        voiceId: '',
        allowedVoiceIds: [],
        monthlyCharacterCap: 0,
      },
      'azure-speech': {
        enabled: false,
        modelId: 'standard',
        voiceId: 'en-US-JennyNeural',
        allowedVoiceIds: ['en-US-JennyNeural'],
        monthlyCharacterCap: 0,
      },
      'openai-tts': {
        enabled: false,
        modelId: 'gpt-4o-mini-tts',
        voiceId: 'alloy',
        allowedVoiceIds: [...OPENAI_TTS_VOICES],
        monthlyCharacterCap: 0,
      },
      'browser-system': {
        enabled: true,
        modelId: '',
        voiceId: '',
        allowedVoiceIds: [],
        monthlyCharacterCap: 0,
      },
    },
  };
}

function boundedNumber(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function strictObject(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const result = value as Record<string, unknown>;
  const unknownKey = Object.keys(result).find((key) => !allowedKeys.includes(key));
  if (unknownKey) throw new Error(`${label} contains unsupported field "${unknownKey}".`);
  return result;
}

function parseSelection(value: unknown, label: string): TtsProviderSelection {
  const input = strictObject(value, ['providerId', 'modelId', 'voiceId'], label);
  if (typeof input.providerId !== 'string' || !PROVIDER_SET.has(input.providerId)) {
    throw new Error(`${label}.providerId is not supported.`);
  }
  const selection: TtsProviderSelection = { providerId: input.providerId as TtsProviderId };
  if (input.modelId !== undefined) {
    if (typeof input.modelId !== 'string' || input.modelId.length > 100) {
      throw new Error(`${label}.modelId is invalid.`);
    }
    selection.modelId = input.modelId;
  }
  if (input.voiceId !== undefined) {
    if (typeof input.voiceId !== 'string' || input.voiceId.length > 100) {
      throw new Error(`${label}.voiceId is invalid.`);
    }
    selection.voiceId = input.voiceId;
  }
  return selection;
}

function parseProviderDefinition(
  providerId: TtsProviderId,
  value: unknown,
): TtsProviderDefinition {
  const input = strictObject(
    value,
    ['enabled', 'modelId', 'voiceId', 'allowedVoiceIds', 'monthlyCharacterCap'],
    `providers.${providerId}`,
  );
  if (typeof input.enabled !== 'boolean') throw new Error(`providers.${providerId}.enabled is invalid.`);
  if (typeof input.modelId !== 'string' || input.modelId.length > 100) {
    throw new Error(`providers.${providerId}.modelId is invalid.`);
  }
  if (typeof input.voiceId !== 'string' || input.voiceId.length > 100) {
    throw new Error(`providers.${providerId}.voiceId is invalid.`);
  }
  if (!Array.isArray(input.allowedVoiceIds) || input.allowedVoiceIds.length > 50) {
    throw new Error(`providers.${providerId}.allowedVoiceIds is invalid.`);
  }
  const allowedVoiceIds = input.allowedVoiceIds.map((voice) => {
    if (typeof voice !== 'string' || !voice || voice.length > 100) {
      throw new Error(`providers.${providerId}.allowedVoiceIds contains an invalid voice.`);
    }
    return voice;
  });
  if (new Set(allowedVoiceIds).size !== allowedVoiceIds.length) {
    throw new Error(`providers.${providerId}.allowedVoiceIds contains duplicates.`);
  }
  const monthlyCharacterCap = boundedNumber(
    input.monthlyCharacterCap,
    0,
    100_000_000,
    `providers.${providerId}.monthlyCharacterCap`,
  );
  if (!Number.isSafeInteger(monthlyCharacterCap)) {
    throw new Error(`providers.${providerId}.monthlyCharacterCap must be a whole number.`);
  }
  if (providerId === 'openai-tts') {
    if (!OPENAI_TTS_MODELS.has(input.modelId)) {
      throw new Error('The selected OpenAI TTS model is not supported.');
    }
    const supportedVoices = new Set<string>(OPENAI_TTS_VOICES);
    if (
      !supportedVoices.has(input.voiceId) ||
      allowedVoiceIds.some((voice) => !supportedVoices.has(voice))
    ) {
      throw new Error('The selected OpenAI TTS voice is not supported.');
    }
  }
  if (
    providerId === 'azure-speech' &&
    (!AZURE_VOICE_PATTERN.test(input.voiceId) ||
      allowedVoiceIds.some((voice) => !AZURE_VOICE_PATTERN.test(voice)))
  ) {
    throw new Error('Azure Speech voices must be valid neural voice short names.');
  }
  if (input.voiceId && allowedVoiceIds.length > 0 && !allowedVoiceIds.includes(input.voiceId)) {
    throw new Error(`providers.${providerId}.voiceId must be in allowedVoiceIds.`);
  }
  return {
    enabled: input.enabled,
    modelId: input.modelId,
    voiceId: input.voiceId,
    allowedVoiceIds,
    monthlyCharacterCap,
  };
}

export function parseTtsProviderPolicy(value: unknown): TtsProviderPolicy {
  const input = strictObject(
    value,
    [
      'version',
      'organizationDefault',
      'fallbacks',
      'allowDeviceOverrides',
      'allowStudentVoiceChoice',
      'rate',
      'volume',
      'autoPlay',
      'repeatCount',
      'providers',
    ],
    'TTS policy',
  );
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    throw new Error('TTS policy version must be a positive integer.');
  }
  if (typeof input.allowDeviceOverrides !== 'boolean' ||
      typeof input.allowStudentVoiceChoice !== 'boolean' ||
      typeof input.autoPlay !== 'boolean') {
    throw new Error('TTS policy switches are invalid.');
  }
  if (!Number.isSafeInteger(input.repeatCount) || Number(input.repeatCount) < 1 || Number(input.repeatCount) > 3) {
    throw new Error('TTS repeatCount must be between 1 and 3.');
  }
  if (!Array.isArray(input.fallbacks) || input.fallbacks.length > TTS_PROVIDER_IDS.length - 1) {
    throw new Error('TTS fallbacks are invalid.');
  }
  const providersInput = strictObject(input.providers, TTS_PROVIDER_IDS, 'providers');
  const providers = Object.fromEntries(
    TTS_PROVIDER_IDS.map((providerId) => {
      if (!(providerId in providersInput)) throw new Error(`providers.${providerId} is required.`);
      return [providerId, parseProviderDefinition(providerId, providersInput[providerId])];
    }),
  ) as Record<TtsProviderId, TtsProviderDefinition>;

  const requestedDefault = parseSelection(input.organizationDefault, 'organizationDefault');
  const requestedFallbacks = input.fallbacks.map((selection, index) =>
    parseSelection(selection, `fallbacks[${index}]`));
  const requestedChain = [requestedDefault, ...requestedFallbacks];
  if (new Set(requestedChain.map((selection) => selection.providerId)).size !== requestedChain.length) {
    throw new Error('A TTS provider may appear only once in the provider chain.');
  }

  // Browser neural inference is not a production provider. Canonicalizing here
  // keeps old persisted Kokoro/Piper policies usable without letting a new API
  // write re-enable model execution in the web container.
  providers['browser-local'] = {
    enabled: false,
    modelId: '',
    voiceId: '',
    allowedVoiceIds: [],
    monthlyCharacterCap: 0,
  };
  const requestedCompanion = providers['windows-companion'];
  const companionVoice = KOKORO_VOICE_SET.has(requestedCompanion.voiceId)
    ? requestedCompanion.voiceId
    : 'af_heart';
  providers['windows-companion'] = {
    enabled: requestedCompanion.enabled,
    modelId: 'kokoro',
    voiceId: companionVoice,
    allowedVoiceIds: [...KOKORO_TTS_VOICES],
    monthlyCharacterCap: 0,
  };

  const canonicalSelection = (selection: TtsProviderSelection): TtsProviderSelection => {
    if (selection.providerId !== 'browser-local' &&
        selection.providerId !== 'windows-companion') {
      return selection;
    }
    return {
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: providers['windows-companion'].voiceId,
    };
  };
  const browserWasReferenced = requestedChain.some(
    (selection) => selection.providerId === 'browser-local',
  );
  const organizationDefault = canonicalSelection(requestedDefault);
  if (browserWasReferenced) providers['windows-companion'].enabled = true;
  const seen = new Set<TtsProviderId>([organizationDefault.providerId]);
  const fallbacks: TtsProviderSelection[] = [];
  for (const requested of requestedFallbacks) {
    const selection = canonicalSelection(requested);
    if (seen.has(selection.providerId)) continue;
    seen.add(selection.providerId);
    fallbacks.push(selection);
  }
  if (!providers[organizationDefault.providerId].enabled) {
    throw new Error('The organization default provider must be enabled.');
  }
  const chain = [organizationDefault, ...fallbacks];
  for (const selection of chain) {
    const provider = providers[selection.providerId];
    if (selection.modelId && selection.modelId !== provider.modelId) {
      throw new Error(`${selection.providerId} selection does not match its configured model.`);
    }
    if (
      selection.voiceId &&
      provider.allowedVoiceIds.length > 0 &&
      !provider.allowedVoiceIds.includes(selection.voiceId)
    ) {
      throw new Error(`${selection.providerId} selection uses a voice that is not allowed.`);
    }
  }

  return {
    version: Number(input.version),
    organizationDefault,
    fallbacks,
    allowDeviceOverrides: input.allowDeviceOverrides,
    allowStudentVoiceChoice: input.allowStudentVoiceChoice,
    rate: boundedNumber(input.rate, 0.5, 2, 'rate'),
    volume: boundedNumber(input.volume, 0, 1, 'volume'),
    autoPlay: input.autoPlay,
    repeatCount: Number(input.repeatCount),
    providers,
  };
}

function legacyNumber(value: string | null | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function migrateLegacyTtsSettings(settings: LegacyTtsSettings): TtsProviderPolicy {
  const policy = createDefaultTtsProviderPolicy();
  const legacyEngine = settings.active_tts_model;
  const voice = settings.tts_default_voice?.trim() || undefined;
  if (legacyEngine === 'browser-tts') {
    policy.organizationDefault = { providerId: 'browser-system', voiceId: voice };
    policy.fallbacks = policy.fallbacks.filter((item) => item.providerId !== 'browser-system');
  } else {
    const companionVoice = voice && KOKORO_VOICE_SET.has(voice) ? voice : 'af_heart';
    policy.providers['windows-companion'].voiceId = companionVoice;
    policy.organizationDefault = {
      providerId: 'windows-companion',
      modelId: 'kokoro',
      voiceId: companionVoice,
    };
  }
  policy.rate = legacyNumber(settings.tts_default_rate, 0.9, 0.5, 2);
  policy.volume = legacyNumber(settings.tts_default_volume, 1, 0, 1);
  policy.autoPlay = settings.tts_auto_play !== 'false';
  policy.repeatCount = Math.round(legacyNumber(settings.tts_repeat_count, 1, 1, 3));
  policy.allowStudentVoiceChoice = settings.tts_allow_student_choice === 'true';
  return policy;
}

export function ttsProviderChain(
  policy: TtsProviderPolicy,
  deviceOverride?: DeviceTtsOverride | null,
): TtsProviderSelection[] {
  const configured = [policy.organizationDefault, ...policy.fallbacks]
    .filter((selection) =>
      selection.providerId !== 'browser-local' &&
      policy.providers[selection.providerId].enabled);
  if (!policy.allowDeviceOverrides || !deviceOverride?.selection) return configured;
  const override = deviceOverride.selection;
  if (override.providerId === 'browser-local') return configured;
  const provider = policy.providers[override.providerId];
  if (!provider?.enabled) return configured;
  if (override.modelId && override.modelId !== provider.modelId) return configured;
  if (
    override.voiceId &&
    provider.allowedVoiceIds.length > 0 &&
    !provider.allowedVoiceIds.includes(override.voiceId)
  ) return configured;
  return [override, ...configured.filter((item) => item.providerId !== override.providerId)];
}

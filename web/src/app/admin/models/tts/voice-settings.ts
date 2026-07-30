import {
  KOKORO_TTS_VOICES,
  OPENAI_TTS_VOICES,
  type TtsProviderId,
  type TtsProviderPolicy,
  type TtsProviderSelection,
} from "@/lib/speech/tts-policy"

export type ProviderKind = "On device" | "Local server" | "Cloud API" | "System"

export interface ProviderModelOption {
  id: string
  name: string
  description: string
}

export interface ProviderVoiceOption {
  id: string
  name: string
  detail: string
}

export interface ProviderMeta {
  id: TtsProviderId
  name: string
  shortName: string
  kind: ProviderKind
  description: string
  setupHint: string
  models: ProviderModelOption[]
  voices: ProviderVoiceOption[]
}

const KOKORO_VOICE_NAMES: Record<string, string> = {
  af_heart: "Heart",
  af_bella: "Bella",
  af_nicole: "Nicole",
  af_sarah: "Sarah",
  am_michael: "Michael",
  am_adam: "Adam",
  am_fenrir: "Fenrir",
  am_puck: "Puck",
  bf_emma: "Emma",
  bf_isabella: "Isabella",
  bm_george: "George",
  bm_fable: "Fable",
}

const KOKORO_VOICES: ProviderVoiceOption[] = KOKORO_TTS_VOICES.map((id) => ({
  id,
  name: KOKORO_VOICE_NAMES[id] ?? id,
  detail: `${id.startsWith("a") ? "American" : "British"} · ${id[1] === "f" ? "Female" : "Male"}`,
}))

const OPENAI_VOICES: ProviderVoiceOption[] = OPENAI_TTS_VOICES.map((voice) => ({
  id: voice,
  name: voice.charAt(0).toUpperCase() + voice.slice(1),
  detail: voice === "marin" || voice === "cedar" ? "Latest natural voice" : "OpenAI preset",
}))

export const TTS_PROVIDER_META: readonly ProviderMeta[] = [
  {
    id: "windows-companion",
    name: "Windows speech companion",
    shortName: "Windows companion",
    kind: "Local server",
    description: "The signed Windows companion serves Kokoro locally without placing neural model files in the web application.",
    setupHint: "Pair this browser, authorize the signed Kokoro package once, then install it through the loopback companion.",
    models: [
      { id: "kokoro", name: "Kokoro", description: "Natural CPU voice through the Windows companion" },
    ],
    voices: KOKORO_VOICES,
  },
  {
    id: "custom-local",
    name: "Custom local speech server",
    shortName: "Custom server",
    kind: "Local server",
    description: "Connect an Ollama-style, OpenAI-compatible speech server running on the learner’s computer.",
    setupHint: "The server must expose a loopback /health endpoint and an OpenAI-compatible /v1/audio/speech route.",
    models: [],
    voices: [],
  },
  {
    id: "azure-speech",
    name: "Azure AI Speech",
    shortName: "Azure Speech",
    kind: "Cloud API",
    description: "Microsoft-hosted neural speech using the organization’s Azure Speech resource.",
    setupHint: "Requires an Azure Speech key, resource region, and a positive monthly character cap.",
    models: [
      { id: "standard", name: "Azure Neural TTS", description: "Production neural speech through Azure AI Speech" },
    ],
    voices: [
      { id: "en-US-JennyNeural", name: "Jenny", detail: "English (United States) · Female" },
      { id: "en-US-GuyNeural", name: "Guy", detail: "English (United States) · Male" },
      { id: "en-GB-SoniaNeural", name: "Sonia", detail: "English (United Kingdom) · Female" },
      { id: "en-GB-RyanNeural", name: "Ryan", detail: "English (United Kingdom) · Male" },
    ],
  },
  {
    id: "openai-tts",
    name: "OpenAI text-to-speech",
    shortName: "OpenAI TTS",
    kind: "Cloud API",
    description: "Natural cloud speech through the organization’s OpenAI API account.",
    setupHint: "Requires an OpenAI API key and a positive monthly character cap.",
    models: [
      { id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS", description: "Recommended balance of natural speech and latency" },
      { id: "tts-1", name: "TTS-1", description: "Optimized for real-time speech" },
      { id: "tts-1-hd", name: "TTS-1 HD", description: "Higher fidelity with greater latency" },
    ],
    voices: OPENAI_VOICES,
  },
  {
    id: "browser-system",
    name: "Browser system voice",
    shortName: "System voice",
    kind: "System",
    description: "Uses a voice supplied by the operating system and browser with no model download.",
    setupHint: "Availability and quality vary by device. Keep this last in the fallback chain.",
    models: [
      { id: "", name: "System speech synthesis", description: "Uses the best matching voice installed on this device" },
    ],
    voices: [],
  },
] as const

const LEGACY_BROWSER_LOCAL_META: ProviderMeta = {
  id: "browser-local",
  name: "Retired browser neural voice",
  shortName: "Retired browser local",
  kind: "On device",
  description: "Retired production provider. Existing policies migrate to the Windows companion.",
  setupHint: "Use the signed Windows companion for local Kokoro.",
  models: [],
  voices: [],
}

export const PROVIDER_META_BY_ID = {
  ...Object.fromEntries(TTS_PROVIDER_META.map((provider) => [provider.id, provider])),
  "browser-local": LEGACY_BROWSER_LOCAL_META,
} as Record<TtsProviderId, ProviderMeta>

export function providerSelection(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  overrides: Partial<Pick<TtsProviderSelection, "modelId" | "voiceId">> = {},
): TtsProviderSelection {
  if (providerId === "browser-local") {
    return providerSelection(policy, "windows-companion", {
      modelId: "kokoro",
      voiceId: policy.providers["windows-companion"].voiceId || "af_heart",
    })
  }
  const provider = policy.providers[providerId]
  const modelId = overrides.modelId ?? provider.modelId
  const voiceId = overrides.voiceId ?? provider.voiceId
  return {
    providerId,
    ...(modelId ? { modelId } : {}),
    ...(voiceId ? { voiceId } : {}),
  }
}

export function promoteOrganizationDefault(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  overrides: Partial<Pick<TtsProviderSelection, "modelId" | "voiceId">> = {},
): TtsProviderPolicy {
  if (providerId === "browser-local") {
    return promoteOrganizationDefault(policy, "windows-companion", {
      modelId: "kokoro",
      voiceId: policy.providers["windows-companion"].voiceId || "af_heart",
    })
  }
  const next = structuredClone(policy)
  const previousDefault = next.organizationDefault
  const provider = next.providers[providerId]
  provider.enabled = true

  if (overrides.modelId !== undefined) provider.modelId = overrides.modelId
  if (overrides.voiceId !== undefined) {
    provider.voiceId = overrides.voiceId
    if (overrides.voiceId && !provider.allowedVoiceIds.includes(overrides.voiceId)) {
      provider.allowedVoiceIds = [...provider.allowedVoiceIds, overrides.voiceId]
    }
  }

  next.organizationDefault = providerSelection(next, providerId, overrides)
  const remainingFallbacks = next.fallbacks.filter((item) => item.providerId !== providerId)
  if (
    previousDefault.providerId !== providerId &&
    next.providers[previousDefault.providerId].enabled
  ) {
    next.fallbacks = [
      previousDefault,
      ...remainingFallbacks.filter((item) => item.providerId !== previousDefault.providerId),
    ]
  } else {
    next.fallbacks = remainingFallbacks
  }
  return next
}

export function setProviderEnabled(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  enabled: boolean,
): TtsProviderPolicy {
  if (providerId === "browser-local") return policy
  if (!enabled && policy.organizationDefault.providerId === providerId) return policy
  const next = structuredClone(policy)
  next.providers[providerId].enabled = enabled
  if (!enabled) next.fallbacks = next.fallbacks.filter((item) => item.providerId !== providerId)
  return next
}

export function toggleFallback(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
): TtsProviderPolicy {
  if (providerId === "browser-local") return policy
  if (policy.organizationDefault.providerId === providerId) return policy
  const next = structuredClone(policy)
  const index = next.fallbacks.findIndex((item) => item.providerId === providerId)
  if (index >= 0) {
    next.fallbacks.splice(index, 1)
    return next
  }
  next.providers[providerId].enabled = true
  next.fallbacks.push(providerSelection(next, providerId))
  return next
}

export function moveFallback(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  direction: -1 | 1,
): TtsProviderPolicy {
  if (providerId === "browser-local") return policy
  const next = structuredClone(policy)
  const index = next.fallbacks.findIndex((item) => item.providerId === providerId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.fallbacks.length) return policy
  const [item] = next.fallbacks.splice(index, 1)
  next.fallbacks.splice(target, 0, item)
  return next
}

export function updateProviderModel(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  modelId: string,
): TtsProviderPolicy {
  if (providerId === "browser-local") return policy
  const next = structuredClone(policy)
  next.providers[providerId].modelId = modelId
  if (next.organizationDefault.providerId === providerId) {
    next.organizationDefault = providerSelection(next, providerId)
  }
  next.fallbacks = next.fallbacks.map((item) =>
    item.providerId === providerId ? providerSelection(next, providerId) : item,
  )
  return next
}

export function updateProviderVoice(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  voiceId: string,
): TtsProviderPolicy {
  if (providerId === "browser-local") return policy
  const next = structuredClone(policy)
  const provider = next.providers[providerId]
  provider.voiceId = voiceId
  if (voiceId && !provider.allowedVoiceIds.includes(voiceId)) {
    provider.allowedVoiceIds = [...provider.allowedVoiceIds, voiceId]
  }
  if (next.organizationDefault.providerId === providerId) {
    next.organizationDefault = providerSelection(next, providerId)
  }
  next.fallbacks = next.fallbacks.map((item) =>
    item.providerId === providerId ? providerSelection(next, providerId) : item,
  )
  return next
}

export function isSelectionDefault(
  policy: TtsProviderPolicy,
  providerId: TtsProviderId,
  modelId?: string,
  voiceId?: string,
): boolean {
  if (providerId === "browser-local") return false
  const current = policy.organizationDefault
  return current.providerId === providerId &&
    (modelId === undefined || current.modelId === modelId) &&
    (voiceId === undefined || current.voiceId === voiceId)
}

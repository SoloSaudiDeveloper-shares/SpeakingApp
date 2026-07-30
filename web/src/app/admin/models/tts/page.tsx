"use client"

import Link from "next/link"
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Cloud,
  Computer,
  Gauge,
  HardDriveDownload,
  KeyRound,
  Loader2,
  MonitorSpeaker,
  Play,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils/cn"
import { getTtsEngine } from "@/lib/speech/tts-factory"
import {
  createDefaultTtsProviderPolicy,
  migrateLegacyTtsSettings,
  type DeviceTtsOverride,
  type LegacyTtsSettings,
  type TtsProviderId,
  type TtsProviderPolicy,
} from "@/lib/speech/tts-policy"
import {
  PROVIDER_META_BY_ID,
  TTS_PROVIDER_META,
  isSelectionDefault,
  moveFallback,
  promoteOrganizationDefault,
  providerSelection,
  setProviderEnabled,
  toggleFallback,
  updateProviderModel,
  updateProviderVoice,
  type ProviderVoiceOption,
} from "./voice-settings"

type HealthState = "healthy" | "unhealthy" | "unknown"
type ReadinessMap = Partial<Record<"azure-speech" | "openai-tts", boolean>>
type UsageItem = {
  provider: string
  periodMonth: string
  characters: number
  requestCount: number
  cap: number
  remaining: number
}

interface AdminConfigResponse {
  policy: TtsProviderPolicy
  source?: "policy" | "legacy"
  readiness?: ReadinessMap
  effectiveUsage?: UsageItem[]
}

const PREVIEW_TEXT = "Hello! This is a preview of the selected voice."
const DEFAULT_COMPANION_ENDPOINT = "http://127.0.0.1:17841"

function Toggle({
  checked,
  onCheckedChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-11 w-14 shrink-0 items-center rounded-full border p-1 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "justify-end border-primary bg-primary" : "justify-start border-border bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="h-5 w-5 rounded-full bg-primary-foreground shadow-sm" aria-hidden="true" />
    </button>
  )
}

function ProviderGlyph({ id, className }: { id: TtsProviderId; className?: string }) {
  const iconClass = cn("h-5 w-5", className)
  switch (id) {
    case "windows-companion":
      return <Computer className={iconClass} aria-hidden="true" />
    case "custom-local":
      return <Server className={iconClass} aria-hidden="true" />
    case "azure-speech":
      return <Cloud className={iconClass} aria-hidden="true" />
    case "openai-tts":
      return <Bot className={iconClass} aria-hidden="true" />
    default:
      return <MonitorSpeaker className={iconClass} aria-hidden="true" />
  }
}

function StatusBadge({
  state,
  configured,
  enabled,
}: {
  state: HealthState
  configured: boolean
  enabled: boolean
}) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <X className="h-3 w-3" aria-hidden="true" /> Disabled
      </span>
    )
  }
  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
        <AlertCircle className="h-3 w-3 text-destructive" aria-hidden="true" /> Setup needed
      </span>
    )
  }
  if (state === "healthy") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Healthy
      </span>
    )
  }
  if (state === "unhealthy") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertCircle className="h-3 w-3" aria-hidden="true" /> Check failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <CircleDashed className="h-3 w-3" aria-hidden="true" /> Configured
    </span>
  )
}

function DefaultBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
      <Check className="h-3 w-3" aria-hidden="true" /> Current default
    </span>
  )
}

function SetDefaultButton({
  current,
  disabled,
  onClick,
  compact = false,
}: {
  current: boolean
  disabled?: boolean
  onClick: () => void
  compact?: boolean
}) {
  if (current) return <DefaultBadge />
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors",
        "hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
        compact && "min-h-11 text-xs",
      )}
    >
      Set as default
    </button>
  )
}

function playAudioBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  return new Promise((resolve, reject) => {
    const cleanUp = () => URL.revokeObjectURL(url)
    audio.onended = () => {
      cleanUp()
      resolve()
    }
    audio.onerror = () => {
      cleanUp()
      reject(new Error("The preview audio could not be played."))
    }
    audio.play().catch((error) => {
      cleanUp()
      reject(error)
    })
  })
}

function policyFingerprint(policy: TtsProviderPolicy | null) {
  return policy ? JSON.stringify(policy) : ""
}

export default function TTSSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<TtsProviderPolicy | null>(null)
  const [baseline, setBaseline] = useState<TtsProviderPolicy | null>(null)
  const [source, setSource] = useState<"policy" | "legacy">("policy")
  const [selectedProviderId, setSelectedProviderId] = useState<TtsProviderId>("windows-companion")
  const [readiness, setReadiness] = useState<ReadinessMap>({})
  const [usage, setUsage] = useState<UsageItem[]>([])
  const [health, setHealth] = useState<Partial<Record<TtsProviderId, HealthState>>>({})
  const [voices, setVoices] = useState<ProviderVoiceOption[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState<{ tone: "error" | "info"; message: string } | null>(null)

  const [deviceOverride, setDeviceOverrideState] = useState<DeviceTtsOverride>({})
  const [baselineDeviceOverride, setBaselineDeviceOverride] = useState<DeviceTtsOverride>({})
  const [deviceProviderId, setDeviceProviderId] = useState<TtsProviderId | "">("")
  const [companionEndpoint, setCompanionEndpoint] = useState(DEFAULT_COMPANION_ENDPOINT)
  const [customEndpoint, setCustomEndpoint] = useState("")
  const [localVoiceInput, setLocalVoiceInput] = useState("")
  const [pairingCode, setPairingCode] = useState("")
  const [pairing, setPairing] = useState(false)
  const [companionPaired, setCompanionPaired] = useState(false)
  const [modelInstallCode, setModelInstallCode] = useState("")
  const [modelInstalling, setModelInstalling] = useState(false)
  const [companionModelStatus, setCompanionModelStatus] = useState<{
    configured: boolean
    installed: boolean
    release: string | null
    installing: boolean
    phase: string
    receivedBytes: number
    expectedBytes: number
  } | null>(null)
  const modelInstallAbort = useRef<AbortController | null>(null)
  const [azureKeyInput, setAzureKeyInput] = useState("")
  const [openAiKeyInput, setOpenAiKeyInput] = useState("")
  const [azureRegion, setAzureRegion] = useState("eastus")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [{
          getDeviceTtsOverride,
          getWindowsCompanionModelStatus,
        }, configResponse, settingsResponse] = await Promise.all([
          import("@/lib/speech/tts-provider-client"),
          fetch("/api/admin/tts/config", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }).catch(() => null),
        ])

        const settings = settingsResponse?.ok
          ? await settingsResponse.json().catch(() => ({})) as Record<string, string>
          : {}
        let nextPolicy: TtsProviderPolicy
        let nextSource: "policy" | "legacy" = "policy"
        let nextReadiness: ReadinessMap = {}
        let nextUsage: UsageItem[] = []

        if (configResponse.ok) {
          const body = await configResponse.json() as AdminConfigResponse
          nextPolicy = body.policy
          nextSource = body.source ?? "policy"
          nextReadiness = body.readiness ?? {}
          nextUsage = body.effectiveUsage ?? []
        } else if (settingsResponse?.ok) {
          nextPolicy = migrateLegacyTtsSettings(settings as LegacyTtsSettings)
          nextSource = "legacy"
        } else {
          throw new Error("Voice settings could not be loaded.")
        }

        const storedOverride = await getDeviceTtsOverride()
        const modelStatus = storedOverride?.companionEndpoint && storedOverride.companionToken
          ? await getWindowsCompanionModelStatus(
              storedOverride.companionEndpoint,
              storedOverride.companionToken,
            ).catch(() => null)
          : null
        if (cancelled) return

        const normalizedOverride = storedOverride ?? {}
        setPolicy(nextPolicy)
        setBaseline(structuredClone(nextPolicy))
        setSource(nextSource)
        setReadiness(nextReadiness)
        setUsage(nextUsage)
        setDeviceOverrideState(normalizedOverride)
        setBaselineDeviceOverride(structuredClone(normalizedOverride))
        setDeviceProviderId(normalizedOverride.selection?.providerId ?? "")
        setCompanionEndpoint(normalizedOverride.companionEndpoint ?? DEFAULT_COMPANION_ENDPOINT)
        setCustomEndpoint(normalizedOverride.customLocalEndpoint ?? "")
        setCompanionPaired(Boolean(normalizedOverride.companionToken))
        setCompanionModelStatus(modelStatus)
        if (settings.azure_speech_region) setAzureRegion(settings.azure_speech_region)

        const browserSystem = getTtsEngine("browser-tts")
        setHealth({
          "browser-system": browserSystem.isAvailable() ? "healthy" : "unhealthy",
        })
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Voice settings could not be loaded.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedProvider = PROVIDER_META_BY_ID[selectedProviderId]
  const selectedDefinition = policy?.providers[selectedProviderId]

  useEffect(() => {
    if (!policy) return
    let cancelled = false
    const loadVoices = async () => {
      setVoicesLoading(true)
      try {
        if (selectedProviderId === "browser-system") {
          const items = await getTtsEngine("browser-tts").listVoices()
          if (!cancelled) {
            setVoices(items.map((voice) => ({
              id: voice.id,
              name: voice.label,
              detail: voice.lang ?? "System voice",
            })))
          }
          return
        }
        const metadataVoices = selectedProvider.voices
        if (metadataVoices.length > 0) {
          if (!cancelled) setVoices([...metadataVoices])
          return
        }
        const providerVoices = policy.providers[selectedProviderId].allowedVoiceIds
        if (!cancelled) {
          setVoices(providerVoices.map((voice) => ({ id: voice, name: voice, detail: "Server voice ID" })))
        }
      } catch {
        if (!cancelled) setVoices([])
      } finally {
        if (!cancelled) setVoicesLoading(false)
      }
    }
    void loadVoices()
    return () => {
      cancelled = true
    }
  }, [policy, selectedProvider, selectedProviderId])

  const currentDeviceDraft = useMemo<DeviceTtsOverride>(() => ({
    ...deviceOverride,
    ...(deviceProviderId && policy ? { selection: providerSelection(policy, deviceProviderId) } : {}),
    ...(!deviceProviderId ? { selection: undefined } : {}),
    companionEndpoint: companionEndpoint.trim() || undefined,
    customLocalEndpoint: customEndpoint.trim() || undefined,
  }), [companionEndpoint, customEndpoint, deviceOverride, deviceProviderId, policy])

  const dirty = useMemo(
    () => policyFingerprint(policy) !== policyFingerprint(baseline) ||
      JSON.stringify(currentDeviceDraft) !== JSON.stringify(baselineDeviceOverride) ||
      Boolean(azureKeyInput.trim() || openAiKeyInput.trim()),
    [azureKeyInput, baseline, baselineDeviceOverride, currentDeviceDraft, openAiKeyInput, policy],
  )

  const isConfigured = (providerId: TtsProviderId) => {
    if (!policy) return false
    switch (providerId) {
      case "windows-companion":
        return Boolean(companionEndpoint.trim())
      case "custom-local":
        return Boolean(customEndpoint.trim() && policy.providers[providerId].modelId.trim())
      case "azure-speech":
      case "openai-tts":
        return Boolean(readiness[providerId])
      default:
        return true
    }
  }

  const canSetDefault = (providerId: TtsProviderId) => {
    if (!policy) return false
    if (providerId === "azure-speech") {
      return policy.providers[providerId].monthlyCharacterCap > 0 &&
        (Boolean(readiness[providerId]) || Boolean(azureKeyInput.trim()))
    }
    if (providerId === "openai-tts") {
      return policy.providers[providerId].monthlyCharacterCap > 0 &&
        (Boolean(readiness[providerId]) || Boolean(openAiKeyInput.trim()))
    }
    return isConfigured(providerId)
  }

  const makeDefault = (
    providerId: TtsProviderId,
    overrides: { modelId?: string; voiceId?: string } = {},
  ) => {
    if (!policy || !canSetDefault(providerId)) {
      setNotice({
        tone: "error",
        message: "Complete this provider’s setup before making it the organization default.",
      })
      return
    }
    setPolicy(promoteOrganizationDefault(policy, providerId, overrides))
    setNotice(null)
  }

  const setEnabled = (providerId: TtsProviderId, enabled: boolean) => {
    if (!policy) return
    if (!enabled && policy.organizationDefault.providerId === providerId) {
      setNotice({ tone: "error", message: "Choose another organization default before disabling this provider." })
      return
    }
    setPolicy(setProviderEnabled(policy, providerId, enabled))
    setNotice(null)
  }

  const saveCredential = async (key: "azure_speech_key" | "openai_api_key", value: string) => {
    if (!value.trim()) return
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: value.trim() }),
    })
    if (!response.ok) throw new Error(`The ${key === "azure_speech_key" ? "Azure" : "OpenAI"} key could not be saved.`)
  }

  const saveLegacyPolicy = async (draft: TtsProviderPolicy) => {
    const selected = draft.organizationDefault
    const legacyEngine = selected.providerId === "browser-system"
      ? "browser-tts"
      : "kokoro"
    const values = {
      active_tts_model: legacyEngine,
      tts_default_voice: selected.voiceId ?? "",
      tts_default_rate: String(draft.rate),
      tts_default_volume: String(draft.volume),
      tts_allow_student_choice: String(draft.allowStudentVoiceChoice),
      tts_auto_play: String(draft.autoPlay),
      tts_repeat_count: String(draft.repeatCount),
    }
    await Promise.all(Object.entries(values).map(async ([key, value]) => {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      if (!response.ok) throw new Error("Legacy voice settings could not be saved.")
    }))
  }

  const handleSave = async () => {
    if (!policy || !baseline) return
    setSaving(true)
    setSaved(false)
    setNotice(null)
    try {
      const {
        clearDeviceTtsOverride,
        invalidateTtsProviderConfigCache,
        setDeviceTtsOverride,
      } = await import("@/lib/speech/tts-provider-client")
      await Promise.all([
        saveCredential("azure_speech_key", azureKeyInput),
        saveCredential("openai_api_key", openAiKeyInput),
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "azure_speech_region", value: azureRegion.trim() || "eastus" }),
        }).then((response) => {
          if (!response.ok) throw new Error("The Azure region could not be saved.")
        }),
      ])

      if (deviceProviderId || currentDeviceDraft.companionEndpoint || currentDeviceDraft.customLocalEndpoint) {
        await setDeviceTtsOverride(currentDeviceDraft)
      } else {
        await clearDeviceTtsOverride()
      }

      const response = await fetch("/api/admin/tts/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: baseline.version, policy }),
      })

      let persistedPolicy = policy
      if (response.ok) {
        const body = await response.json() as AdminConfigResponse
        persistedPolicy = body.policy
        setSource("policy")
      } else if (response.status === 404 || response.status === 405) {
        await saveLegacyPolicy(policy)
        setSource("legacy")
      } else if (response.status === 409) {
        throw new Error("These settings changed in another session. Reload the page before saving again.")
      } else {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || "Voice settings could not be saved.")
      }

      setPolicy(persistedPolicy)
      setBaseline(structuredClone(persistedPolicy))
      setDeviceOverrideState(currentDeviceDraft)
      setBaselineDeviceOverride(structuredClone(currentDeviceDraft))
      setAzureKeyInput("")
      setOpenAiKeyInput("")
      setReadiness((current) => ({
        ...current,
        ...(azureKeyInput.trim() ? { "azure-speech": true } : {}),
        ...(openAiKeyInput.trim() ? { "openai-tts": true } : {}),
      }))
      invalidateTtsProviderConfigCache()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Voice settings could not be saved." })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!baseline) return
    setPolicy(structuredClone(baseline))
    setDeviceProviderId(baselineDeviceOverride.selection?.providerId ?? "")
    setCompanionEndpoint(baselineDeviceOverride.companionEndpoint ?? DEFAULT_COMPANION_ENDPOINT)
    setCustomEndpoint(baselineDeviceOverride.customLocalEndpoint ?? "")
    setAzureKeyInput("")
    setOpenAiKeyInput("")
    setNotice(null)
  }

  const handleTest = async () => {
    if (!policy) return
    setTesting(true)
    setNotice(null)
    try {
      const definition = policy.providers[selectedProviderId]
      if (selectedProviderId === "browser-system") {
        await getTtsEngine("browser-tts").speak(PREVIEW_TEXT, {
          voice: definition.voiceId || null,
          rate: policy.rate,
          volume: policy.volume,
        })
      } else if (selectedProviderId === "windows-companion" || selectedProviderId === "custom-local") {
        const endpoint = selectedProviderId === "windows-companion" ? companionEndpoint : customEndpoint
        const { probeLocalTtsEndpoint } = await import("@/lib/speech/tts-provider-client")
        const result = await probeLocalTtsEndpoint(
          endpoint,
          selectedProviderId === "windows-companion"
            ? deviceOverride.companionToken
            : deviceOverride.customLocalToken,
        )
        if (!result.ok) throw new Error(result.detail || "The local speech server did not respond.")
        const token = selectedProviderId === "windows-companion"
          ? deviceOverride.companionToken
          : deviceOverride.customLocalToken
        const requestStartedAt = Date.now()
        const response = await fetch(`${result.endpoint}/v1/audio/speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            input: PREVIEW_TEXT,
            model: definition.modelId,
            voice: definition.voiceId || undefined,
            response_format: selectedProviderId === "windows-companion" ? "wav" : "mp3",
            speed: policy.rate,
          }),
          redirect: "error",
        })
        const responseReceivedAt = Date.now()
        if (!response.ok || !(response.headers.get("content-type") ?? "").match(/^audio\//i)) {
          throw new Error(`Local synthesis test failed (${response.status}).`)
        }
        const [
          { readTtsAudioResponse },
          { recordTtsBrowserStreamTelemetry },
        ] = await Promise.all([
          import("@/lib/speech/tts-audio-stream-client"),
          import("@/lib/speech/tts-provider-client"),
        ])
        await playAudioBlob(await readTtsAudioResponse(response, {
          provider: selectedProviderId,
          requestStartedAt,
          responseReceivedAt,
          onTelemetry: recordTtsBrowserStreamTelemetry,
        }))
      } else {
        const requestStartedAt = Date.now()
        const [
          {
            fetchTtsAudioResponseWithDeadline,
            readTtsAudioResponse,
          },
          { recordTtsBrowserStreamTelemetry },
        ] = await Promise.all([
          import("@/lib/speech/tts-audio-stream-client"),
          import("@/lib/speech/tts-provider-client"),
        ])
        const { response, responseReceivedAt } =
          await fetchTtsAudioResponseWithDeadline(
            `/api/admin/tts/providers/${selectedProviderId}/test`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input: PREVIEW_TEXT,
                voiceId: definition.voiceId,
                rate: policy.rate,
              }),
            },
            {
              provider: selectedProviderId,
              requestStartedAt,
              onTelemetry: recordTtsBrowserStreamTelemetry,
            },
          )
        if (!response.ok) {
          throw new Error(`Provider test failed (${response.status}).`)
        }
        await playAudioBlob(await readTtsAudioResponse(response, {
          provider: selectedProviderId,
          requestStartedAt,
          responseReceivedAt,
          onTelemetry: recordTtsBrowserStreamTelemetry,
        }))
      }
      setHealth((current) => ({ ...current, [selectedProviderId]: "healthy" }))
      setNotice({
        tone: "info",
        message: `${selectedProvider.name} responded successfully.`,
      })
    } catch (error) {
      setHealth((current) => ({ ...current, [selectedProviderId]: "unhealthy" }))
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The provider test failed." })
    } finally {
      setTesting(false)
    }
  }

  const addLocalVoice = () => {
    if (!policy || !localVoiceInput.trim()) return
    setPolicy(updateProviderVoice(policy, selectedProviderId, localVoiceInput.trim()))
    setVoices((current) => current.some((voice) => voice.id === localVoiceInput.trim())
      ? current
      : [...current, { id: localVoiceInput.trim(), name: localVoiceInput.trim(), detail: "Server voice ID" }])
    setLocalVoiceInput("")
  }

  const handlePairCompanion = async () => {
    if (!/^\d{6}$/.test(pairingCode)) {
      setNotice({ tone: "error", message: "Enter the six-digit code shown by the Windows companion." })
      return
    }
    setPairing(true)
    setNotice(null)
    try {
      const client = await import("@/lib/speech/tts-provider-client")
      if (!("pairWindowsCompanion" in client)) {
        throw new Error("Companion pairing is not available in this build.")
      }
      await client.pairWindowsCompanion(companionEndpoint, pairingCode)
      const storedOverride = await client.getDeviceTtsOverride()
      setDeviceOverrideState(storedOverride ?? {})
      setBaselineDeviceOverride(storedOverride ?? {})
      setCompanionPaired(Boolean(storedOverride?.companionToken))
      setPairingCode("")
      const modelStatus = storedOverride?.companionEndpoint && storedOverride.companionToken
        ? await client.getWindowsCompanionModelStatus(
            storedOverride.companionEndpoint,
            storedOverride.companionToken,
          ).catch(() => null)
        : null
      setCompanionModelStatus(modelStatus)
      setHealth((current) => ({
        ...current,
        "windows-companion": modelStatus?.installed ? "unknown" : "unhealthy",
      }))
      setNotice({ tone: "info", message: "This browser is paired with the Windows speech companion." })
    } catch (error) {
      setHealth((current) => ({ ...current, "windows-companion": "unhealthy" }))
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Companion pairing failed." })
    } finally {
      setPairingCode("")
      setPairing(false)
    }
  }

  const handleInstallCompanionModel = async () => {
    const token = deviceOverride.companionToken
    if (!token || !companionPaired) {
      setNotice({ tone: "error", message: "Pair this browser before installing Kokoro." })
      return
    }
    if (!/^\d{6}$/.test(modelInstallCode)) {
      setNotice({ tone: "error", message: "Enter the six-digit model installation code generated by a PC administrator." })
      return
    }
    setModelInstalling(true)
    setNotice(null)
    const controller = new AbortController()
    modelInstallAbort.current = controller
    let progressTimer: ReturnType<typeof setInterval> | null = null
    try {
      const {
        getWindowsCompanionModelStatus,
        installWindowsCompanionModel,
      } = await import("@/lib/speech/tts-provider-client")
      progressTimer = setInterval(() => {
        void getWindowsCompanionModelStatus(companionEndpoint, token)
          .then(setCompanionModelStatus)
          .catch(() => undefined)
      }, 1000)
      const status = await installWindowsCompanionModel(
        companionEndpoint,
        token,
        modelInstallCode,
        controller.signal,
      )
      setCompanionModelStatus(status)
      setHealth((current) => ({ ...current, "windows-companion": "unknown" }))
      setNotice({
        tone: "info",
        message: "The signed Kokoro package was verified and installed. Test the companion before making it default.",
      })
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Kokoro installation failed." })
    } finally {
      if (progressTimer) clearInterval(progressTimer)
      modelInstallAbort.current = null
      setModelInstallCode("")
      setModelInstalling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-label="Loading voice settings">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </div>
    )
  }

  if (loadError || !policy || !selectedDefinition) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-2xl border border-destructive/30 bg-card p-6">
          <AlertCircle className="mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
          <h1 className="text-xl font-bold text-foreground">Voice settings are unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError ?? "The provider configuration is invalid."}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Try again
          </button>
        </div>
      </main>
    )
  }

  const selectedIsFallback = policy.fallbacks.some((item) => item.providerId === selectedProviderId)
  const selectedIsDefault = policy.organizationDefault.providerId === selectedProviderId
  const selectedConfigured = isConfigured(selectedProviderId)
  const selectedUsage = usage.find((item) => item.provider === selectedProviderId)
  const customModel = selectedProviderId === "custom-local"

  return (
    <main className="mx-auto w-full max-w-[90rem] space-y-6 px-4 pb-28 pt-5 sm:px-6 sm:pt-7">
      <header className="flex items-start gap-3">
        <Link
          href="/admin/models"
          aria-label="Back to AI and speech models"
          className="chevron-flip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Voice settings</h1>
            {source === "legacy" && (
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Legacy settings loaded
              </span>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground sm:text-base">
            Choose the organization voice, define an ordered fallback path, and control what learners may change on their own devices.
          </p>
        </div>
      </header>

      <section aria-labelledby="voice-chain-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 id="voice-chain-title" className="text-base font-semibold text-foreground">Organization voice path</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Learners start with the default. Unavailable providers are tried from left to right.</p>
          </div>
          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end" aria-label="Voice provider fallback order">
            <li className="flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <span className="text-sm font-semibold text-foreground">
                {PROVIDER_META_BY_ID[policy.organizationDefault.providerId].shortName}
              </span>
              <span className="text-xs text-primary">Default</span>
            </li>
            {policy.fallbacks.map((fallback, index) => (
              <li key={fallback.providerId} className="flex min-h-11 items-center rounded-xl border border-border bg-background ps-3">
                <span className="me-2 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {index + 2}
                </span>
                <span className="text-sm font-medium text-foreground">{PROVIDER_META_BY_ID[fallback.providerId].shortName}</span>
                <button
                  type="button"
                  aria-label={`Move ${PROVIDER_META_BY_ID[fallback.providerId].name} earlier`}
                  disabled={index === 0}
                  onClick={() => setPolicy(moveFallback(policy, fallback.providerId, -1))}
                  className="ms-2 inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${PROVIDER_META_BY_ID[fallback.providerId].name} later`}
                  disabled={index === policy.fallbacks.length - 1}
                  onClick={() => setPolicy(moveFallback(policy, fallback.providerId, 1))}
                  className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)]">
        <nav aria-label="Voice providers" className="rounded-2xl border border-border bg-card p-2 shadow-sm lg:sticky lg:top-4">
          <div className="px-3 pb-2 pt-2">
            <h2 className="text-sm font-semibold text-foreground">Providers</h2>
            <p className="text-xs text-muted-foreground">Select one to configure it.</p>
          </div>
          <ul className="space-y-1">
            {TTS_PROVIDER_META.map((provider) => {
              const providerDefinition = policy.providers[provider.id]
              const currentDefault = policy.organizationDefault.providerId === provider.id
              return (
                <li key={provider.id} className={cn(
                  "rounded-xl border transition-colors",
                  selectedProviderId === provider.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted",
                )}>
                  <button
                    type="button"
                    aria-current={selectedProviderId === provider.id ? "page" : undefined}
                    onClick={() => {
                      setSelectedProviderId(provider.id)
                      setNotice(null)
                    }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-start"
                  >
                    <span className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                      selectedProviderId === provider.id
                        ? "border-primary/30 bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground",
                    )}>
                      <ProviderGlyph id={provider.id} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{provider.shortName}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {providerDefinition.enabled ? provider.kind : "Disabled"}
                        {health[provider.id] === "healthy" && <CheckCircle2 className="h-3 w-3 text-primary" aria-label="Healthy" />}
                      </span>
                    </span>
                    <ChevronRight className="chevron-flip h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                  <div className="flex items-center justify-between gap-2 px-3 pb-3">
                    {currentDefault ? (
                      <DefaultBadge />
                    ) : (
                      <SetDefaultButton
                        compact
                        current={false}
                        disabled={!canSetDefault(provider.id)}
                        onClick={() => makeDefault(provider.id)}
                      />
                    )}
                    <span className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      !providerDefinition.enabled
                        ? "bg-muted-foreground/40"
                        : isConfigured(provider.id)
                          ? health[provider.id] === "unhealthy" ? "bg-destructive" : "bg-primary"
                          : "bg-destructive",
                    )} aria-hidden="true" />
                  </div>
                </li>
              )
            })}
          </ul>
        </nav>

        <section aria-labelledby="provider-detail-title" className="min-w-0 space-y-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-muted/40 p-4 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <ProviderGlyph id={selectedProviderId} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{selectedProvider.kind}</p>
                    <h2 id="provider-detail-title" className="text-xl font-bold text-foreground">{selectedProvider.name}</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{selectedProvider.description}</p>
                  </div>
                </div>
                <StatusBadge
                  enabled={selectedDefinition.enabled}
                  configured={selectedConfigured}
                  state={health[selectedProviderId] ?? "unknown"}
                />
              </div>
            </div>

            <div className="space-y-6 p-4 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-h-20 items-center justify-between gap-4 rounded-xl border border-border bg-background p-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Provider enabled</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedIsDefault ? "Choose another default before disabling." : "Disabled providers are skipped."}
                    </p>
                  </div>
                  <Toggle
                    checked={selectedDefinition.enabled}
                    disabled={selectedIsDefault}
                    onCheckedChange={(enabled) => setEnabled(selectedProviderId, enabled)}
                    label={`${selectedDefinition.enabled ? "Disable" : "Enable"} ${selectedProvider.name}`}
                  />
                </div>
                <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Organization default</p>
                    <p className="mt-1 text-xs text-muted-foreground">Applied unless a permitted device override is available.</p>
                  </div>
                  <SetDefaultButton
                    current={selectedIsDefault}
                    disabled={!canSetDefault(selectedProviderId)}
                    onClick={() => makeDefault(selectedProviderId)}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Fallback path</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Use this provider if those before it cannot speak.</p>
                  </div>
                  <button
                    type="button"
                    disabled={selectedIsDefault || !selectedDefinition.enabled}
                    onClick={() => setPolicy(toggleFallback(policy, selectedProviderId))}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedIsFallback ? "Remove from fallbacks" : "Add as last fallback"}
                  </button>
                </div>
              </div>

              {(selectedProviderId === "windows-companion" || selectedProviderId === "custom-local") && (
                <div>
                  <label htmlFor="local-server-endpoint" className="block text-sm font-semibold text-foreground">
                    Current device endpoint
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">Stored only in this browser. Only loopback addresses are accepted by the speech client.</p>
                  <input
                    id="local-server-endpoint"
                    type="url"
                    dir="ltr"
                    spellCheck={false}
                    value={selectedProviderId === "windows-companion" ? companionEndpoint : customEndpoint}
                    onChange={(event) => selectedProviderId === "windows-companion"
                      ? setCompanionEndpoint(event.target.value)
                      : setCustomEndpoint(event.target.value)}
                    placeholder={selectedProviderId === "windows-companion" ? DEFAULT_COMPANION_ENDPOINT : "http://127.0.0.1:8000"}
                    className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                  />
                  <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    The app never sends this endpoint or its local pairing token to the application server.
                  </p>
                </div>
              )}

              {selectedProviderId === "windows-companion" && (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Pair this browser</h3>
                        <span className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          companionPaired
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                        )}>
                          {companionPaired ? "Paired" : "Not paired"}
                        </span>
                      </div>
                      <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                        Enter the one-time six-digit code shown by the companion. The returned token is stored only in this browser’s private device database.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testing || !companionPaired}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Gauge className="h-4 w-4" aria-hidden="true" />}
                      Test connection
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <label htmlFor="companion-pairing-code" className="sr-only">Six-digit companion pairing code</label>
                      <input
                        id="companion-pairing-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        dir="ltr"
                        value={pairingCode}
                        onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        aria-describedby="companion-code-help"
                        className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] text-foreground sm:max-w-52"
                      />
                      <span id="companion-code-help" className="sr-only">Enter exactly six digits.</span>
                      <button
                        type="button"
                        onClick={handlePairCompanion}
                        disabled={pairing || pairingCode.length !== 6}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {pairing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                        {pairing ? "Pairing…" : companionPaired ? "Pair again" : "Pair companion"}
                      </button>
                  </div>
                  {companionPaired && (
                    <div className="mt-4 border-t border-border pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Signed Kokoro model</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {companionModelStatus?.installed
                              ? `Installed${companionModelStatus.release ? ` · release ${companionModelStatus.release.slice(0, 8)}` : ""}`
                              : companionModelStatus?.configured === false
                                ? "This companion release does not have a pinned model signing key."
                                : "Not installed or status unavailable."}
                          </p>
                          {modelInstalling && companionModelStatus?.expectedBytes ? (
                            <p className="mt-1 text-xs text-primary" role="status">
                              {companionModelStatus.phase.replaceAll("-", " ")} ·{" "}
                              {Math.min(100, Math.round(
                                (companionModelStatus.receivedBytes / companionModelStatus.expectedBytes) * 100,
                              ))}%
                            </p>
                          ) : null}
                        </div>
                        <span className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          companionModelStatus?.installed
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                        )}>
                          {companionModelStatus?.installed ? "Installed" : "Action required"}
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        A PC administrator must generate a one-time installation code. This prevents a paired learner account from changing machine-wide model files.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <label htmlFor="model-install-code" className="sr-only">Six-digit model installation authorization code</label>
                        <input
                          id="model-install-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          dir="ltr"
                          value={modelInstallCode}
                          onChange={(event) => setModelInstallCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="000000"
                          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] text-foreground sm:max-w-52"
                        />
                        <button
                          type="button"
                          onClick={handleInstallCompanionModel}
                          disabled={modelInstalling || modelInstallCode.length !== 6}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {modelInstalling
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <HardDriveDownload className="h-4 w-4" aria-hidden="true" />}
                          {modelInstalling
                            ? "Verifying and installing…"
                            : companionModelStatus?.installed ? "Install update" : "Install Kokoro"}
                        </button>
                        {modelInstalling && (
                          <button
                            type="button"
                            onClick={() => modelInstallAbort.current?.abort()}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            Cancel and resume later
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {customModel && (
                <div>
                  <label htmlFor="custom-model-id" className="block text-sm font-semibold text-foreground">OpenAI-compatible model ID</label>
                  <p className="mt-1 text-xs text-muted-foreground">Use the exact model identifier exposed by the local speech server.</p>
                  <input
                    id="custom-model-id"
                    type="text"
                    dir="ltr"
                    value={selectedDefinition.modelId}
                    onChange={(event) => setPolicy(updateProviderModel(policy, selectedProviderId, event.target.value))}
                    placeholder="kokoro"
                    className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                  />
                  <div className="mt-3 flex justify-end">
                    <SetDefaultButton
                      current={isSelectionDefault(policy, selectedProviderId, selectedDefinition.modelId)}
                      disabled={!canSetDefault(selectedProviderId)}
                      onClick={() => makeDefault(selectedProviderId, { modelId: selectedDefinition.modelId })}
                    />
                  </div>
                </div>
              )}

              {(selectedProviderId === "azure-speech" || selectedProviderId === "openai-tts") && (
                <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cloud-api-key" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      {selectedProviderId === "azure-speech" ? "Azure Speech key" : "OpenAI API key"}
                    </label>
                    <input
                      id="cloud-api-key"
                      type="password"
                      autoComplete="new-password"
                      value={selectedProviderId === "azure-speech" ? azureKeyInput : openAiKeyInput}
                      onChange={(event) => selectedProviderId === "azure-speech"
                        ? setAzureKeyInput(event.target.value)
                        : setOpenAiKeyInput(event.target.value)}
                      placeholder={readiness[selectedProviderId] ? "Saved · type to replace" : "Paste key"}
                      className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">Stored in the configured secret store. Existing keys are never returned here.</p>
                    {selectedProviderId === "openai-tts" && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        OpenAI voices are AI-generated. Use them only where that disclosure is appropriate for your learners.
                      </p>
                    )}
                  </div>
                  {selectedProviderId === "azure-speech" ? (
                    <div>
                      <label htmlFor="azure-region" className="text-sm font-semibold text-foreground">Resource region</label>
                      <input
                        id="azure-region"
                        type="text"
                        dir="ltr"
                        value={azureRegion}
                        onChange={(event) => setAzureRegion(event.target.value)}
                        placeholder="eastus"
                        className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="text-sm font-semibold text-foreground">API readiness</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {readiness["openai-tts"] ? "A secret is configured for this organization." : "Add a key before enabling this provider in the voice path."}
                      </p>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label htmlFor="monthly-character-cap" className="text-sm font-semibold text-foreground">Monthly character cap</label>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        id="monthly-character-cap"
                        type="number"
                        min={0}
                        max={100000000}
                        step={1000}
                        dir="ltr"
                        value={selectedDefinition.monthlyCharacterCap}
                        onChange={(event) => {
                          const value = Math.max(0, Math.min(100000000, Number(event.target.value) || 0))
                          setPolicy({
                            ...policy,
                            providers: {
                              ...policy.providers,
                              [selectedProviderId]: { ...selectedDefinition, monthlyCharacterCap: value },
                            },
                          })
                        }}
                        className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">characters</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${selectedUsage?.cap ? Math.min(100, (selectedUsage.characters / selectedUsage.cap) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {selectedUsage
                        ? `${selectedUsage.characters.toLocaleString()} of ${selectedUsage.cap.toLocaleString()} characters used this month.`
                        : "A cap of 0 prevents this cloud provider from being used."}
                    </p>
                  </div>
                </div>
              )}

              {!customModel && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <HardDriveDownload className="h-5 w-5 text-primary" aria-hidden="true" />
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Model</h3>
                      <p className="text-xs text-muted-foreground">Each model can be promoted directly to the organization default.</p>
                    </div>
                  </div>
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {selectedProvider.models.map((model) => {
                      const current = isSelectionDefault(policy, selectedProviderId, model.id)
                      const configuredModel = selectedDefinition.modelId === model.id
                      return (
                        <div key={model.id || "system"} className={cn(
                          "flex flex-col gap-3 bg-background p-4 sm:flex-row sm:items-center sm:justify-between",
                          configuredModel && "bg-primary/5",
                        )}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{model.name}</p>
                              {configuredModel && <span className="text-xs font-medium text-primary">Configured model</span>}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
                          </div>
                          <SetDefaultButton
                            current={current}
                            disabled={!canSetDefault(selectedProviderId)}
                            onClick={() => makeDefault(selectedProviderId, { modelId: model.id })}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-primary" aria-hidden="true" />
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Voice</h3>
                      <p className="text-xs text-muted-foreground">Set any available voice as the organization default.</p>
                    </div>
                  </div>
                  {voicesLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading voices" />}
                </div>

                {(selectedProviderId === "windows-companion" || selectedProviderId === "custom-local") && (
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                    <label htmlFor="local-voice-id" className="sr-only">Local server voice ID</label>
                    <input
                      id="local-voice-id"
                      type="text"
                      dir="ltr"
                      value={localVoiceInput}
                      onChange={(event) => setLocalVoiceInput(event.target.value)}
                      placeholder="Voice ID exposed by the local server"
                      className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground"
                    />
                    <button
                      type="button"
                      onClick={addLocalVoice}
                      disabled={!localVoiceInput.trim()}
                      className="min-h-11 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Add voice
                    </button>
                  </div>
                )}

                {voices.length > 0 ? (
                  <div className="max-h-[22rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
                    {voices.map((voice) => {
                      const current = isSelectionDefault(policy, selectedProviderId, undefined, voice.id)
                      const configuredVoice = selectedDefinition.voiceId === voice.id
                      return (
                        <div key={voice.id} className={cn(
                          "flex min-h-16 flex-col gap-3 bg-background p-4 sm:flex-row sm:items-center sm:justify-between",
                          configuredVoice && "bg-primary/5",
                        )}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{voice.name}</p>
                              {configuredVoice && <span className="text-xs font-medium text-primary">Configured voice</span>}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground" dir="auto">{voice.detail || voice.id}</p>
                          </div>
                          <SetDefaultButton
                            current={current}
                            disabled={!canSetDefault(selectedProviderId)}
                            onClick={() => makeDefault(selectedProviderId, { voiceId: voice.id })}
                          />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/30 p-5 text-sm text-muted-foreground">
                    {voicesLoading
                      ? "Loading voices…"
                      : selectedProviderId === "windows-companion" || selectedProviderId === "custom-local"
                        ? "Add a voice ID exposed by the local speech server."
                        : "No voices are available on this device."}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Setup note
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{selectedProvider.setupHint}</p>
                {(selectedProviderId === "azure-speech" || selectedProviderId === "openai-tts") && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Testing this cloud provider synthesizes a short sample and counts toward its configured quota.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section aria-labelledby="learner-policy-title" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <SlidersHorizontal className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 id="learner-policy-title" className="text-base font-semibold text-foreground">Learner and playback policy</h2>
            <p className="mt-1 text-sm text-muted-foreground">Organization values apply first. Device choices are respected only when explicitly allowed.</p>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border bg-background p-4">
            <div className="flex min-h-14 items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Allow device provider overrides</p>
                <p className="mt-1 text-xs text-muted-foreground">Lets a learner prefer an installed local provider on that device.</p>
              </div>
              <Toggle
                checked={policy.allowDeviceOverrides}
                onCheckedChange={(value) => setPolicy({ ...policy, allowDeviceOverrides: value })}
                label="Allow device provider overrides"
              />
            </div>
            <div className="flex min-h-14 items-center justify-between gap-4 border-t border-border pt-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Allow learner voice choice</p>
                <p className="mt-1 text-xs text-muted-foreground">Learners may choose a voice within the approved provider.</p>
              </div>
              <Toggle
                checked={policy.allowStudentVoiceChoice}
                onCheckedChange={(value) => setPolicy({ ...policy, allowStudentVoiceChoice: value })}
                label="Allow learner voice choice"
              />
            </div>
            <div className="border-t border-border pt-4">
              <label htmlFor="device-provider" className="text-sm font-semibold text-foreground">Override on this device</label>
              <select
                id="device-provider"
                value={deviceProviderId}
                disabled={!policy.allowDeviceOverrides}
                onChange={(event) => setDeviceProviderId(event.target.value as TtsProviderId | "")}
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
              >
                <option value="">Use organization default</option>
                {TTS_PROVIDER_META.filter((provider) => policy.providers[provider.id].enabled).map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">This choice stays in this browser and is never an organization-wide change.</p>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-background p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="voice-speed" className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  <span>Speed</span><span className="font-mono text-xs text-primary">{policy.rate.toFixed(1)}×</span>
                </label>
                <input
                  id="voice-speed"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={policy.rate}
                  onChange={(event) => setPolicy({ ...policy, rate: Number(event.target.value) })}
                  className="mt-3 h-11 w-full accent-primary"
                />
              </div>
              <div>
                <label htmlFor="voice-volume" className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  <span>Volume</span><span className="font-mono text-xs text-primary">{Math.round(policy.volume * 100)}%</span>
                </label>
                <input
                  id="voice-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={policy.volume}
                  onChange={(event) => setPolicy({ ...policy, volume: Number(event.target.value) })}
                  className="mt-3 h-11 w-full accent-primary"
                />
              </div>
            </div>
            <div className="flex min-h-14 items-center justify-between gap-4 border-t border-border pt-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Auto-play new words</p>
                <p className="mt-1 text-xs text-muted-foreground">Speak automatically when a new practice word appears.</p>
              </div>
              <Toggle
                checked={policy.autoPlay}
                onCheckedChange={(value) => setPolicy({ ...policy, autoPlay: value })}
                label="Auto-play new words"
              />
            </div>
            <fieldset className="border-t border-border pt-4">
              <legend className="text-sm font-semibold text-foreground">Repeat count</legend>
              <p className="mt-1 text-xs text-muted-foreground">How many times each word is spoken.</p>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={policy.repeatCount === count}
                    onClick={() => setPolicy({ ...policy, repeatCount: count })}
                    className={cn(
                      "h-11 min-w-11 rounded-lg border text-sm font-bold",
                      policy.repeatCount === count
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </section>

      <div
        className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-10px_30px_-18px_rgba(0,0,0,0.45)] backdrop-blur sm:-mx-6 sm:px-6"
        role="region"
        aria-label="Voice settings actions"
      >
        <div className="mx-auto flex max-w-[90rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-sm" aria-live="polite">
            {notice ? (
              <p className={cn("flex items-center gap-2", notice.tone === "error" ? "text-destructive" : "text-foreground")}>
                {notice.tone === "error"
                  ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  : <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                {notice.message}
              </p>
            ) : saved ? (
              <p className="flex items-center gap-2 text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> Voice settings saved.
              </p>
            ) : dirty ? (
              <p className="text-muted-foreground">You have unsaved changes.</p>
            ) : (
              <p className="text-muted-foreground">All changes are saved.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={handleReset}
              disabled={!dirty || saving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !selectedDefinition.enabled || !selectedConfigured}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {testing ? "Testing…" : `Test ${selectedProvider.shortName}`}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saving ? "Saving…" : saved ? "Saved" : "Save voice settings"}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

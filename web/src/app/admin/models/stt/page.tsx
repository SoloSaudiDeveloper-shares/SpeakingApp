"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Mic,
  Loader2,
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Save,
} from "lucide-react"
import { Switch } from "@/components/shared/switch"

/* ─── STT Model Data ────────────────────────────────────────────────────────── */

const STT_MODELS = [
  {
    id: "azure-speech",
    name: "Azure Speech (cloud)",
    provider: "Microsoft Azure AI Speech",
    offline: false,
    compute: "Cloud + offline fallback",
    quality: "Excellent",
    speed: "Real-time",
    wer: "Cloud",
    size: "0 MB",
    description:
      "Uses your Azure Speech resource for cloud speech-to-text. Recommended when you want Microsoft-hosted transcription and Azure pronunciation scoring in the same setup.",
    pros: ["Microsoft Azure hosted", "Uses the same Speech key as pronunciation scoring", "Falls back to offline automatically"],
    cons: ["Requires internet", "Needs an Azure Speech key and region below"],
  },
  {
    id: "groq-whisper",
    name: "Groq Whisper (cloud)",
    provider: "Groq · whisper-large-v3-turbo",
    offline: false,
    compute: "Cloud + offline fallback",
    quality: "Excellent",
    speed: "Real-time",
    wer: "~3%",
    size: "0 MB",
    description:
      "Default. Fast, very accurate cloud transcription. Automatically falls back to the bundled offline Whisper when there's no internet (toggle below).",
    pros: ["Best accuracy", "Very fast", "Falls back to offline automatically"],
    cons: ["Uses internet when available", "Needs a Groq API key set in AI Settings"],
  },
  {
    id: "web-speech-api",
    name: "Web Speech API",
    provider: "Google (via Browser)",
    offline: false,
    compute: "Cloud",
    quality: "Excellent",
    speed: "Real-time",
    wer: "~5%",
    size: "0 MB",
    description:
      "Browser built-in. Sends audio to Google servers for transcription. Does NOT work in the packaged Electron app.",
    pros: ["Real-time streaming"],
    cons: [
      "Requires internet",
      "Does not work in the standalone app",
      "Chrome/Edge only",
    ],
  },
  {
    id: "webai-whisper-tiny",
    name: "Whisper Tiny (English)",
    provider: "OpenAI (via WebAI.js)",
    offline: true,
    compute: "WebGPU / CPU (WASM)",
    quality: "Fair",
    speed: "Fast",
    wer: "~8.7%",
    size: "39 MB",
    description:
      "Smallest Whisper model. Runs entirely in browser via ONNX Runtime. Fast but less accurate on accented speech.",
    pros: ["Fully offline", "Fast inference", "Tiny download"],
    cons: ["Lower accuracy on accented English", "No streaming (batch only)"],
  },
  {
    id: "webai-whisper-base",
    name: "Whisper Base (English)",
    provider: "OpenAI (via WebAI.js)",
    offline: false,
    compute: "Download required",
    quality: "Good",
    speed: "Medium",
    wer: "~5.8%",
    size: "73 MB",
    description:
      "Balanced Whisper model. It can run locally after its model files are downloaded, but it is not bundled with this app.",
    pros: ["Good accuracy", "Runs locally after download", "Reasonable speed"],
    cons: ["Requires internet for first use", "Slower on CPU-only devices"],
  },
  {
    id: "webai-whisper-small",
    name: "Whisper Small (English)",
    provider: "OpenAI (via WebAI.js)",
    offline: false,
    compute: "Download required",
    quality: "Very Good",
    speed: "Slow",
    wer: "~4.2%",
    size: "466 MB",
    description:
      "Higher accuracy Whisper model. It can run locally after download, but its files are not bundled with this app.",
    pros: ["Near cloud-level accuracy", "Runs locally after download"],
    cons: ["Requires internet for first use", "Large download", "Slow on CPU"],
  },
  {
    id: "webai-moonshine-tiny",
    name: "Moonshine Tiny (English)",
    provider: "Useful Sensors (via WebAI.js)",
    offline: false,
    compute: "Download required",
    quality: "Good",
    speed: "Very Fast",
    wer: "~7.5%",
    size: "27 MB",
    description:
      "Optimized for English. Fast after download, but the model and VAD files are not bundled with this app.",
    pros: ["Fast local inference after download", "Smallest download", "Good for low-end devices"],
    cons: ["Requires internet for first use", "English only", "Lower accuracy than Whisper Base"],
  },
  {
    id: "webai-moonshine-base",
    name: "Moonshine Base (English)",
    provider: "Useful Sensors (via WebAI.js)",
    offline: false,
    compute: "Download required",
    quality: "Very Good",
    speed: "Fast",
    wer: "~5.5%",
    size: "60 MB",
    description:
      "Larger Moonshine model with excellent accuracy for its size. It runs locally only after model files are downloaded.",
    pros: ["Great accuracy/size ratio", "Fast after download"],
    cons: ["Requires internet for first use", "English only"],
  },
]

/* ─── Badge helpers ─────────────────────────────────────────────────────────── */

function qualityColor(q: string) {
  if (q === "Excellent") return "bg-emerald-500/20 text-emerald-400"
  if (q === "Very Good") return "bg-blue-500/20 text-blue-400"
  if (q === "Good") return "bg-yellow-500/20 text-yellow-400"
  if (q === "Fair") return "bg-orange-500/20 text-orange-400"
  return "bg-muted text-muted-foreground"
}

function speedColor(s: string) {
  if (s === "Very Fast" || s === "Real-time") return "bg-emerald-500/20 text-emerald-400"
  if (s === "Fast") return "bg-blue-500/20 text-blue-400"
  if (s === "Medium") return "bg-yellow-500/20 text-yellow-400"
  if (s === "Slow") return "bg-red-500/20 text-red-400"
  return "bg-muted text-muted-foreground"
}

function computeColor(c: string) {
  if (c === "Cloud") return "bg-purple-500/20 text-purple-400"
  if (c.includes("WebGPU") || c.includes("CPU")) return "bg-blue-500/20 text-blue-400"
  return "bg-muted text-muted-foreground"
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {label}
    </span>
  )
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function STTSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [activeSTT, setActiveSTT] = useState("groq-whisper")
  const [mode, setMode] = useState<"online" | "local">("online")
  const [allowFallback, setAllowFallback] = useState(true)
  const [livePreview, setLivePreview] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // STT-specific settings
  // Azure Pronunciation Assessment
  const [azureKeyInput, setAzureKeyInput] = useState("")
  const [azureConfigured, setAzureConfigured] = useState(false)
  const [azureRegion, setAzureRegion] = useState("eastus")
  const [azureSaving, setAzureSaving] = useState(false)
  const [azureSaved, setAzureSaved] = useState(false)
  const [azureTesting, setAzureTesting] = useState(false)
  const [azureTestResult, setAzureTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [language, setLanguage] = useState("en-US")
  const [continuous, setContinuous] = useState(true)
  const [autoStop, setAutoStop] = useState(true)
  const [silenceTimeout, setSilenceTimeout] = useState(3)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [confidenceThreshold, setConfidenceThreshold] = useState(50)
  const [pauseWarningSeconds, setPauseWarningSeconds] = useState(3)
  const [scoredPauseThresholdMs, setScoredPauseThresholdMs] = useState(1000)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/settings")
        if (res.ok) {
          const settings = await res.json()
          if (settings.active_stt_model) {
            setActiveSTT(settings.active_stt_model)
            setMode(String(settings.active_stt_model).startsWith("webai-") ? "local" : "online")
          }
          if (settings.stt_allow_offline_fallback !== undefined) setAllowFallback(settings.stt_allow_offline_fallback !== "false")
          if (settings.stt_live_preview !== undefined) setLivePreview(settings.stt_live_preview !== "false")
          if (settings.azure_speech_key) setAzureConfigured(true)
          if (settings.azure_speech_region) setAzureRegion(settings.azure_speech_region)
          if (settings.stt_language) setLanguage(settings.stt_language)
          if (settings.stt_continuous !== undefined) setContinuous(settings.stt_continuous === "true")
          if (settings.stt_auto_stop !== undefined) setAutoStop(settings.stt_auto_stop === "true")
          if (settings.stt_silence_timeout) setSilenceTimeout(Number(settings.stt_silence_timeout))
          if (settings.stt_noise_suppression !== undefined) setNoiseSuppression(settings.stt_noise_suppression === "true")
          if (settings.stt_confidence_threshold) setConfidenceThreshold(Number(settings.stt_confidence_threshold))
          if (settings.stt_pause_warning_seconds) setPauseWarningSeconds(Number(settings.stt_pause_warning_seconds))
          if (settings.stt_scored_pause_threshold_ms) setScoredPauseThresholdMs(Math.max(500, Math.min(3000, Number(settings.stt_scored_pause_threshold_ms))))
        }
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
  }, [])

  const saveSetting = async (key: string, value: string) => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
    } catch { /* ignore */ }
  }

  const activateModel = async (id: string) => {
    setActiveSTT(id)
    await saveSetting("active_stt_model", id)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    await Promise.all([
      saveSetting("stt_allow_offline_fallback", String(allowFallback)),
      saveSetting("stt_live_preview", String(livePreview)),
      saveSetting("stt_language", language),
      saveSetting("stt_continuous", String(continuous)),
      saveSetting("stt_auto_stop", String(autoStop)),
      saveSetting("stt_silence_timeout", String(silenceTimeout)),
      saveSetting("stt_noise_suppression", String(noiseSuppression)),
      saveSetting("stt_confidence_threshold", String(confidenceThreshold)),
      saveSetting("stt_pause_warning_seconds", String(pauseWarningSeconds)),
      saveSetting("stt_scored_pause_threshold_ms", String(scoredPauseThresholdMs)),
    ])
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveAzure = async () => {
    setAzureSaving(true)
    setAzureTestResult(null)
    if (azureKeyInput.trim()) { await saveSetting("azure_speech_key", azureKeyInput.trim()); setAzureConfigured(true) }
    await saveSetting("azure_speech_region", azureRegion.trim() || "eastus")
    setAzureKeyInput("")
    setAzureSaving(false); setAzureSaved(true); setTimeout(() => setAzureSaved(false), 2000)
  }

  const handleTestAzure = async () => {
    setAzureTesting(true)
    setAzureTestResult(null)
    try {
      const res = await fetch("/api/stt/azure-status")
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setAzureTestResult({ ok: true, message: `Azure Speech is reachable in ${data.region || azureRegion}.` })
      } else {
        setAzureTestResult({ ok: false, message: data.detail || data.error || `Azure test failed (${res.status}).` })
      }
    } catch (e) {
      setAzureTestResult({ ok: false, message: e instanceof Error ? e.message : "Azure test failed." })
    } finally {
      setAzureTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  const onlineModelIds = new Set(["azure-speech", "groq-whisper", "web-speech-api"])
  const displayedModels = STT_MODELS.filter((m) => mode === "online" ? onlineModelIds.has(m.id) : !onlineModelIds.has(m.id))

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/models" className="text-muted-foreground hover:text-foreground transition">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Speech Recognition</h1>
          <p className="text-sm text-muted-foreground">Choose how student speech is turned into text. Pick a cloud provider for best accuracy or local models for offline use.</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setMode("online")}
          className={`rounded-xl border p-5 text-left transition ${mode === "online" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Online cloud</h2>
              <p className="mt-1 text-sm text-muted-foreground">Azure Speech, Groq Whisper, or browser speech. Best accuracy, needs internet and keys where required.</p>
            </div>
            {mode === "online" && <CheckCircle2 size={18} className="text-primary" />}
          </div>
        </button>
        <button
          onClick={() => setMode("local")}
          className={`rounded-xl border p-5 text-left transition ${mode === "local" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Local / offline</h2>
              <p className="mt-1 text-sm text-muted-foreground">Bundled Whisper or downloadable Hugging Face models. Better privacy, lower accuracy on weak microphones.</p>
            </div>
            {mode === "local" && <CheckCircle2 size={18} className="text-primary" />}
          </div>
        </button>
      </section>

      {/* ─── Model Cards ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-1">{mode === "online" ? "Online speech engines" : "Local speech engines"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {mode === "online"
            ? "Use this when the computer has internet and you want the most reliable transcription."
            : "Use this when the app must work offline. Download-required models come from Hugging Face on first use."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayedModels.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-5 shadow-sm transition ${
                activeSTT === m.id
                  ? "border-primary bg-primary/5 shadow-primary/10 shadow-md"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{m.name}</h3>
                  <p className="text-[10px] text-muted-foreground">{m.provider}</p>
                </div>
                {activeSTT === m.id && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Check size={12} className="text-primary-foreground" />
                  </span>
                )}
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge label={m.quality} className={qualityColor(m.quality)} />
                <Badge label={m.speed} className={speedColor(m.speed)} />
                <Badge label={m.compute} className={computeColor(m.compute)} />
                {m.offline ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">
                    <WifiOff size={8} /> Offline
                  </span>
                ) : m.compute === "Download required" ? (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-500/20 text-blue-400">
                    <Wifi size={8} /> Download
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400">
                    <Wifi size={8} /> Online
                  </span>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                <span>WER: {m.wer}</span>
                <span>Size: {m.size}</span>
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground mb-3">{m.description}</p>

              {/* Pros / Cons */}
              <div className="space-y-1.5 mb-4">
                {m.pros.map((p) => (
                  <div key={p} className="flex items-start gap-1.5 text-xs">
                    <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{p}</span>
                  </div>
                ))}
                {m.cons.map((c) => (
                  <div key={c} className="flex items-start gap-1.5 text-xs">
                    <AlertTriangle size={12} className="text-orange-400 shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{c}</span>
                  </div>
                ))}
              </div>

              {/* Activate button */}
              <button
                onClick={() => activateModel(m.id)}
                className={`w-full rounded-md px-3 py-2 text-xs font-semibold transition ${
                  activeSTT === m.id
                    ? "bg-primary/20 text-primary cursor-default"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {activeSTT === m.id ? "Active" : "Activate"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Pronunciation Assessment (Azure) ────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-1">Azure Speech key</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Optional but recommended. The same Azure Speech key powers <strong>Azure Speech-to-text</strong> when you activate that model above and <strong>phoneme-level pronunciation assessment</strong> for reference tasks. Without a key, the app keeps working with Groq/local transcription and standard transcript scoring.
        </p>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5 max-w-xl">
          <div className={`flex items-center gap-2 text-sm ${azureConfigured ? "text-emerald-400" : "text-muted-foreground"}`}>
            {azureConfigured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} className="text-amber-400" />}
            {azureConfigured ? "Azure key configured - Azure transcription and phoneme-level scoring can be used." : "No Azure key yet - Azure Speech is unavailable."}
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Azure Speech key</label>
            <input
              type="password"
              value={azureKeyInput}
              onChange={(e) => setAzureKeyInput(e.target.value)}
              placeholder={azureConfigured ? "•••••••• (saved — type to replace)" : "Paste your Azure Speech key"}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Region</label>
            <input
              type="text"
              value={azureRegion}
              onChange={(e) => setAzureRegion(e.target.value)}
              placeholder="eastus"
              className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">The region of your Azure Speech resource, e.g. <code>eastus</code>, <code>westeurope</code>.</p>
          </div>
          <button
            onClick={handleTestAzure}
            disabled={azureTesting || (!azureConfigured && !azureKeyInput.trim())}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition disabled:opacity-50"
          >
            {azureTesting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {azureTesting ? "Testing..." : "Test Azure Speech"}
          </button>
          {azureTestResult && (
            <div className={`rounded-md border px-3 py-2 text-sm ${azureTestResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
              {azureTestResult.message}
            </div>
          )}
          <button
            onClick={handleSaveAzure}
            disabled={azureSaving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {azureSaving ? <Loader2 size={14} className="animate-spin" /> : azureSaved ? <Check size={14} /> : <Save size={14} />}
            {azureSaving ? "Saving…" : azureSaved ? "Saved!" : "Save Azure key"}
          </button>
        </div>
      </section>

      {/* ─── STT Settings ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Recognition Settings</h2>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
          {/* Offline fallback */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Offline fallback</label>
              <p className="text-xs text-muted-foreground">
                When the selected cloud engine is not reachable, fall back to the bundled offline Whisper. A small popup tells the student when this happens. Turn off to require internet.
              </p>
            </div>
            <Switch checked={allowFallback} onCheckedChange={setAllowFallback} ariaLabel="Allow local fallback" />
          </div>

          {/* Live transcript preview */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Live transcript preview</label>
              <p className="text-xs text-muted-foreground">
                Show words on screen <strong>while the student speaks</strong> in long drills (e.g. the 4/3/2 monologue). The cloud model can&apos;t stream, so the app re-transcribes the audio every few seconds — this uses more requests. Turn off to transcribe only when they stop. Cloud engine only.
              </p>
            </div>
            <Switch checked={livePreview} onCheckedChange={setLivePreview} ariaLabel="Enable live preview" />
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full max-w-xs"
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-AU">English (Australia)</option>
              <option value="en-IN">English (India)</option>
            </select>
          </div>

          {/* Continuous Recognition */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Continuous Recognition</label>
              <p className="text-xs text-muted-foreground">Keep listening after pauses</p>
            </div>
            <Switch checked={continuous} onCheckedChange={setContinuous} ariaLabel="Continuous recognition" />
          </div>

          {/* Auto-Stop on Silence */}
          <div className="space-y-2 max-w-md">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-foreground">Auto-Stop on Silence</label>
                <p className="text-xs text-muted-foreground">Stop recording after silence</p>
              </div>
              <Switch checked={autoStop} onCheckedChange={setAutoStop} ariaLabel="Auto-stop on silence" />
            </div>
            {autoStop && (
              <div>
                <label className="text-xs text-muted-foreground">
                  Silence timeout: {silenceTimeout}s
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={silenceTimeout}
                  onChange={(e) => setSilenceTimeout(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>1s</span>
                  <span>10s</span>
                </div>
              </div>
            )}
          </div>

          {/* Noise Suppression */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Noise Suppression</label>
              <p className="text-xs text-muted-foreground">Filter background noise</p>
            </div>
            <Switch checked={noiseSuppression} onCheckedChange={setNoiseSuppression} ariaLabel="Noise suppression" />
          </div>

          {/* Pause Warning */}
          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">
              Pause Warning: {pauseWarningSeconds}s
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              How long the student can pause before seeing &ldquo;keep speaking&rdquo; warning
            </p>
            <input
              type="range"
              min={1}
              max={15}
              value={pauseWarningSeconds}
              onChange={(e) => setPauseWarningSeconds(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1s</span>
              <span>15s</span>
            </div>
          </div>

          {/* Scored pause threshold — deliberately separate from the visual warning. */}
          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">Scored pause threshold: {scoredPauseThresholdMs} ms</label>
            <p className="mb-2 text-xs text-muted-foreground">Silence shorter than this is not counted as a scored hesitation. This does not change the visual pause warning above.</p>
            <input type="range" min={500} max={3000} step={100} value={scoredPauseThresholdMs} onChange={(e) => setScoredPauseThresholdMs(Number(e.target.value))} className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>500 ms</span><span>3000 ms</span></div>
          </div>

          {/* Confidence Threshold */}
          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">
              Confidence Threshold: {confidenceThreshold}%
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Minimum confidence to accept a transcription result
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Save */}
          <div className="pt-2">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : saved ? (
                <Check size={14} />
              ) : (
                <Save size={14} />
              )}
              {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

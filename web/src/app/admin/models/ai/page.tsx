"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Brain,
  Activity,
  Loader2,
  ArrowLeft,
  Check,
  Save,
  Trash2,
  Download,
  RefreshCw,
} from "lucide-react"
import { Switch } from "@/components/shared/switch"

interface OllamaModel {
  name: string
  size: number
  modified_at: string
  details?: { parameter_size?: string; quantization_level?: string; family?: string }
}

const RECOMMENDED_OLLAMA = [
  { name: "llama3.1:8b", desc: "Best general-purpose. Great feedback quality.", size: "4.7 GB" },
  { name: "phi3:3.8b", desc: "Lightweight & fast. Good for limited RAM.", size: "2.2 GB" },
  { name: "mistral:7b", desc: "Strong writing & summaries.", size: "4.1 GB" },
  { name: "qwen2.5:7b", desc: "Excellent multilingual (Arabic-English).", size: "4.4 GB" },
  { name: "gemma2:9b", desc: "Strong reasoning & instruction following.", size: "5.4 GB" },
  { name: "gemma3:4b", desc: "Gemma 4B generation — translation & general purpose.", size: "2.5 GB" },
  { name: "gemma3:2b", desc: "Gemma 2B generation — lightweight general purpose.", size: "1.4 GB" },
  { name: "nomic-embed-text", desc: "Embedding model for semantic search & similarity.", size: "274 MB" },
]

const HUGGINGFACE_MODELS = [
  {
    name: "TranslateGemma 4B",
    hfId: "google/translategemma-4b-it",
    desc: "Translation model optimized for Arabic-English and other language pairs.",
    ollamaEquiv: "gemma3:4b",
    type: "Translation",
  },
  {
    name: "Gemma 4 E2B",
    hfId: "google/gemma-4-E2B-it",
    desc: "2B parameter general-purpose model, good for lightweight tasks.",
    ollamaEquiv: "gemma3:2b",
    type: "General",
  },
  {
    name: "Gemma 4 E4B",
    hfId: "google/gemma-4-E4B-it",
    desc: "4B parameter general-purpose model with strong instruction following.",
    ollamaEquiv: "gemma3:4b",
    type: "General",
  },
  {
    name: "EmbeddingGemma 300M",
    hfId: "google/embeddinggemma-300m",
    desc: "300M embedding model for semantic search and text similarity.",
    ollamaEquiv: "nomic-embed-text",
    type: "Embedding",
  },
]

export default function AISettingsPage() {
  const [loading, setLoading] = useState(true)
  const [ollamaUp, setOllamaUp] = useState(false)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [pullName, setPullName] = useState("")
  const [pulling, setPulling] = useState(false)
  const [pullStatus, setPullStatus] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // AI settings
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")
  const [enableAI, setEnableAI] = useState(true)
  const [allowStudentChoice, setAllowStudentChoice] = useState(false)
  const [conversationInputMode, setConversationInputMode] = useState<"both" | "text" | "voice">("both")
  const [scenarioScoringMode, setScenarioScoringMode] = useState<"manual" | "live">("live")

  // AI provider (Ollama / Groq / Grok / OpenAI / Azure-Foundry)
  const [provider, setProvider] = useState<"ollama" | "groq" | "grok" | "openai" | "azure">("ollama")
  const [providerMode, setProviderMode] = useState<"local" | "online">("local")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile")
  const [showGroqKey, setShowGroqKey] = useState(false)
  const [grokApiKey, setGrokApiKey] = useState("")
  const [grokModel, setGrokModel] = useState("grok-2-latest")
  const [openaiApiKey, setOpenaiApiKey] = useState("")
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini")
  const [showGrokKey, setShowGrokKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  // Azure / Microsoft Foundry
  const [azureEndpoint, setAzureEndpoint] = useState("")
  const [azureKey, setAzureKey] = useState("")
  const [azureModel, setAzureModel] = useState("gpt-4o-mini")
  const [azureApiVersion, setAzureApiVersion] = useState("v1")
  const [showAzureKey, setShowAzureKey] = useState(false)
  const [activeModel, setActiveModel] = useState("")
  const [pronunciationPrompt, setPronunciationPrompt] = useState(
    "You are a pronunciation coach. Analyze the student's spoken word and provide brief, encouraging feedback on their pronunciation."
  )
  const [speakingPrompt, setSpeakingPrompt] = useState(
    "You are a speaking coach. Evaluate the student's sentence and provide brief feedback on fluency, grammar, and natural expression."
  )
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(100)
  const [responseStyle, setResponseStyle] = useState("Encouraging")

  const load = async () => {
    setLoading(true)
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings").catch(() => null),
        fetch("/api/ai/status").catch(() => null),
      ])

      if (settingsRes?.ok) {
        const s = await settingsRes.json()
        if (s.ollama_url) setOllamaUrl(s.ollama_url)
        if (s.enable_ai !== undefined) setEnableAI(s.enable_ai === "true")
        if (["ollama", "groq", "grok", "openai", "azure"].includes(s.ai_provider)) {
          setProvider(s.ai_provider)
          setProviderMode(s.ai_provider === "ollama" ? "local" : "online")
        }
        if (s.groq_api_key) setGroqApiKey(s.groq_api_key)
        if (s.groq_model) setGroqModel(s.groq_model)
        if (s.grok_api_key) setGrokApiKey(s.grok_api_key) // server already masked it
        if (s.grok_model) setGrokModel(s.grok_model)
        if (s.openai_api_key) setOpenaiApiKey(s.openai_api_key)
        if (s.openai_model) setOpenaiModel(s.openai_model)
        if (s.azure_endpoint) setAzureEndpoint(s.azure_endpoint)
        if (s.azure_api_key) setAzureKey(s.azure_api_key) // server already masked it
        if (s.azure_model) setAzureModel(s.azure_model)
        if (s.azure_api_version) setAzureApiVersion(s.azure_api_version)
        if (s.allow_student_model_choice !== undefined) setAllowStudentChoice(s.allow_student_model_choice === "true")
        if (s.ai_conversation_input_mode === "both" || s.ai_conversation_input_mode === "text" || s.ai_conversation_input_mode === "voice") {
          setConversationInputMode(s.ai_conversation_input_mode)
        }
        if (s.ai_conversation_scenario_scoring_mode === "manual" || s.ai_conversation_scenario_scoring_mode === "live") {
          setScenarioScoringMode(s.ai_conversation_scenario_scoring_mode)
        }
        if (s.active_ai_model) setActiveModel(s.active_ai_model)
        if (s.pronunciation_prompt) setPronunciationPrompt(s.pronunciation_prompt)
        if (s.speaking_prompt) setSpeakingPrompt(s.speaking_prompt)
        if (s.ai_temperature) setTemperature(Number(s.ai_temperature))
        if (s.ai_max_tokens) setMaxTokens(Number(s.ai_max_tokens))
        if (s.ai_response_style) setResponseStyle(s.ai_response_style)
      }

      if (statusRes?.ok) {
        const status = await statusRes.json()
        setOllamaUp(status.online)
        if (status.online) {
          const modelsRes = await fetch("/api/ai/models").catch(() => null)
          if (modelsRes?.ok) {
            const data = await modelsRes.json()
            setModels(data.models ?? [])
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const saveSetting = async (key: string, value: string) => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
    } catch { /* ignore */ }
  }

  const handlePull = async (name?: string) => {
    const modelName = name || pullName
    if (!modelName) return
    setPulling(true)
    setPullStatus(`Pulling ${modelName}...`)
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pull", name: modelName }),
      })
      const data = await res.json()
      setPullStatus(data.success ? `${modelName} pulled successfully!` : data.error ?? "Pull failed.")
      setPullName("")
      load()
    } catch {
      setPullStatus("Pull failed.")
    }
    setPulling(false)
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete model ${name}?`)) return
    try {
      await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name }),
      })
      load()
    } catch { /* ignore */ }
  }

  const handleActivate = async (name: string) => {
    setActiveModel(name)
    await saveSetting("active_ai_model", name)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    setProviderTestResult(null)
    await Promise.all([
      saveSetting("ollama_url", ollamaUrl),
      saveSetting("enable_ai", String(enableAI)),
      saveSetting("allow_student_model_choice", String(allowStudentChoice)),
      saveSetting("ai_conversation_input_mode", conversationInputMode),
      saveSetting("ai_conversation_scenario_scoring_mode", scenarioScoringMode),
      saveSetting("ai_provider", provider),
      saveSetting("groq_model", groqModel),
      saveSetting("grok_model", grokModel),
      saveSetting("openai_model", openaiModel),
      // API keys: only save if user actually entered a new value (not the mask).
      ...(groqApiKey && groqApiKey !== "••••••••" ? [saveSetting("groq_api_key", groqApiKey)] : []),
      ...(grokApiKey && grokApiKey !== "••••••••" ? [saveSetting("grok_api_key", grokApiKey)] : []),
      ...(openaiApiKey && openaiApiKey !== "••••••••" ? [saveSetting("openai_api_key", openaiApiKey)] : []),
      saveSetting("azure_endpoint", azureEndpoint.trim()),
      saveSetting("azure_model", azureModel.trim()),
      saveSetting("azure_api_version", azureApiVersion.trim() || "v1"),
      ...(azureKey && azureKey !== "••••••••" ? [saveSetting("azure_api_key", azureKey.trim())] : []),
      saveSetting("active_ai_model", activeModel),
      saveSetting("pronunciation_prompt", pronunciationPrompt),
      saveSetting("speaking_prompt", speakingPrompt),
      saveSetting("ai_temperature", String(temperature)),
      saveSetting("ai_max_tokens", String(maxTokens)),
      saveSetting("ai_response_style", responseStyle),
    ])
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTestProvider = async () => {
    setTestingProvider(true)
    setProviderTestResult(null)
    try {
      await handleSaveSettings()
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Reply with one short sentence." },
            { role: "user", content: "Say that the Speaking Lab AI provider test worked." },
          ],
          temperature: 0,
          max_tokens: 40,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const content = String(data.message?.content ?? data.choices?.[0]?.message?.content ?? "").trim()
        setProviderTestResult({ ok: true, message: content || "Provider responded successfully." })
      } else {
        setProviderTestResult({ ok: false, message: data.error || `Provider test failed (${res.status}).` })
      }
    } catch (e) {
      setProviderTestResult({ ok: false, message: e instanceof Error ? e.message : "Provider test failed." })
    } finally {
      setTestingProvider(false)
    }
  }

  const installedNames = new Set(models.map((m) => m.name))
  const providerOptions = [
    { id: "ollama" as const, label: "Ollama", desc: "Local - free/offline" },
    { id: "groq" as const, label: "Groq", desc: "Cloud - free tier" },
    { id: "grok" as const, label: "Grok (xAI)", desc: "Cloud - paid" },
    { id: "openai" as const, label: "OpenAI", desc: "Cloud - paid" },
    { id: "azure" as const, label: "Azure / Foundry", desc: "Your Microsoft deployment" },
  ]
  const visibleProviderOptions = providerOptions.filter((p) => providerMode === "local" ? p.id === "ollama" : p.id !== "ollama")

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/models" className="text-muted-foreground hover:text-foreground transition">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">AI Feedback & Conversation</h1>
          <p className="text-sm text-muted-foreground">Choose the model that writes tutor feedback, conversation replies, teacher insights, and scenarios.</p>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground transition" title="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* ─── Ollama Status ───────────────────────────────────────────────── */}
      <div
        className={`rounded-xl border p-4 shadow-sm ${
          ollamaUp ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"
        }`}
      >
        <div className="flex items-center gap-2">
          <Activity size={16} className={ollamaUp ? "text-emerald-400" : "text-red-400"} />
          <span className="text-sm font-medium text-foreground">
            Ollama: {ollamaUp ? "Online" : "Offline"}
          </span>
        </div>
        {!ollamaUp && (
          <p className="mt-1 text-xs text-muted-foreground">
            Start Ollama to enable AI-powered pronunciation feedback and coaching.
          </p>
        )}
      </div>

      {/* ─── Installed Models ────────────────────────────────────────────── */}
      {ollamaUp && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Installed Models</h2>
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/20">
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Family</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium w-20"></th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr
                    key={m.name}
                    className={`border-t border-border transition ${
                      activeModel === m.name ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground">{m.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{(m.size / 1e9).toFixed(1)} GB</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.details?.family ?? "---"}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleActivate(m.name)}
                        className={`text-xs px-2 py-1 rounded transition ${
                          activeModel === m.name
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {activeModel === m.name ? "Active" : "Activate"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleDelete(m.name)}
                        className="text-red-400 hover:text-red-300 transition"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No models installed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Pull Model ──────────────────────────────────────────────────── */}
      {ollamaUp && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Pull New Model</h2>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm mb-4">
            <div className="flex gap-2">
              <input
                placeholder="e.g. llama3.1:8b, phi3:3.8b"
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                className="bg-background border border-input rounded-md px-3 py-2 flex-1 text-sm"
              />
              <button
                onClick={() => handlePull()}
                disabled={pulling || !pullName}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
              >
                <Download size={14} /> {pulling ? "Pulling..." : "Pull"}
              </button>
            </div>
            {pullStatus && (
              <p className="text-xs text-muted-foreground mt-2">{pullStatus}</p>
            )}
          </div>

          {/* Recommended */}
          <h3 className="text-sm font-semibold text-foreground mb-3">Recommended Models</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {RECOMMENDED_OLLAMA.map((m) => (
              <div
                key={m.name}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  installedNames.has(m.name)
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card"
                }`}
              >
                <div>
                  <span className="text-sm font-medium text-foreground">{m.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {m.desc} ({m.size})
                  </p>
                </div>
                {installedNames.has(m.name) ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check size={12} /> Installed
                  </span>
                ) : (
                  <button
                    onClick={() => handlePull(m.name)}
                    disabled={pulling}
                    className="text-xs bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition disabled:opacity-50"
                  >
                    Pull
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── HuggingFace / Google Gemma Models ────────────────────────────── */}
      {ollamaUp && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">Google Gemma Models (HuggingFace)</h2>
          <p className="text-xs text-muted-foreground mb-4">
            These models are available on HuggingFace. Some have Ollama equivalents you can pull directly.
            Others can be converted using{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">ollama create</code>{" "}
            with a Modelfile pointing to HuggingFace GGUF weights.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {HUGGINGFACE_MODELS.map((m) => {
              const hasEquiv = installedNames.has(m.ollamaEquiv)
              return (
                <div
                  key={m.hfId}
                  className={`rounded-lg border p-4 ${
                    hasEquiv ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{m.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                      {m.type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{m.desc}</p>
                  <p className="text-[11px] text-muted-foreground font-mono mb-2">{m.hfId}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Ollama: <span className="font-mono">{m.ollamaEquiv}</span>
                    </span>
                    {hasEquiv ? (
                      <span className="text-xs text-emerald-400 flex items-center gap-1">
                        <Check size={12} /> Installed
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePull(m.ollamaEquiv)}
                        disabled={pulling}
                        className="text-xs bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition disabled:opacity-50"
                      >
                        Pull Equivalent
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 rounded-lg border border-border bg-card/50 p-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Converting HuggingFace Models to Ollama</h4>
            <p className="text-xs text-muted-foreground mb-2">
              To use a HuggingFace model directly with Ollama, create a Modelfile:
            </p>
            <pre className="bg-background border border-input rounded-md p-3 text-xs font-mono text-muted-foreground overflow-x-auto">
{`# Modelfile example
FROM hf.co/google/gemma-4-E4B-it-GGUF

# Then run:
# ollama create my-gemma4 -f Modelfile`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Ollama supports pulling GGUF models directly from HuggingFace. Use the recommended Ollama
              equivalents above for the easiest setup.
            </p>
          </div>
        </section>
      )}

      {/* ─── AI Provider ─────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => { setProviderMode("local"); setProvider("ollama") }}
          className={`rounded-xl border p-5 text-left transition ${providerMode === "local" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Local model</h2>
              <p className="mt-1 text-sm text-muted-foreground">Use Ollama on this computer. Good for privacy and offline demos, but requires Ollama running.</p>
            </div>
            {providerMode === "local" && <Check size={18} className="text-primary" />}
          </div>
        </button>
        <button
          onClick={() => { setProviderMode("online"); if (provider === "ollama") setProvider("azure") }}
          className={`rounded-xl border p-5 text-left transition ${providerMode === "online" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Online provider</h2>
              <p className="mt-1 text-sm text-muted-foreground">Use Azure/Foundry, Groq, Grok, or OpenAI. Best for reliable feedback and scenario generation.</p>
            </div>
            {providerMode === "online" && <Check size={18} className="text-primary" />}
          </div>
        </button>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">AI Provider</h2>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
          <p className="text-xs text-muted-foreground">
            Choose where AI feedback comes from. <strong>Ollama</strong> runs locally (free, offline).{" "}
            <strong>Groq</strong> is a fast cloud API with a free tier. <strong>Grok (xAI)</strong> and{" "}
            <strong>OpenAI</strong> are paid cloud APIs. <strong>Azure / Foundry</strong> uses your own Microsoft Foundry deployment + key. All cloud providers need an API key — keys are only visible to admins.
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {visibleProviderOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`rounded-md border p-3 text-left transition ${
                  provider === p.id ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30"
                }`}
              >
                <div className={`text-sm font-medium ${provider === p.id ? "text-primary" : "text-foreground"}`}>
                  {p.label}
                </div>
                <div className="mt-0.5 text-[0.7rem] text-muted-foreground">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Groq */}
          {provider === "groq" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Groq API key
                </label>
                <div className="relative">
                  <input
                    type={showGroqKey ? "text" : "password"}
                    value={groqApiKey}
                    onChange={(e) => setGroqApiKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroqKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showGroqKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1 text-[0.65rem] text-muted-foreground">
                  Get a free key at <a className="text-primary underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Stored locally in the SQLite DB; never sent back to non-admin users.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Groq model
                </label>
                <select
                  value={groqModel}
                  onChange={(e) => setGroqModel(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (best, recommended)</option>
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (fastest)</option>
                  <option value="llama3-70b-8192">llama3-70b-8192</option>
                  <option value="llama3-8b-8192">llama3-8b-8192</option>
                  <option value="gemma2-9b-it">gemma2-9b-it</option>
                  <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                </select>
              </div>
            </div>
          )}

          {/* Grok */}
          {provider === "grok" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Grok API key
                </label>
                <div className="relative">
                  <input
                    type={showGrokKey ? "text" : "password"}
                    value={grokApiKey}
                    onChange={(e) => setGrokApiKey(e.target.value)}
                    placeholder="xai-..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGrokKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showGrokKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1 text-[0.65rem] text-muted-foreground">
                  Get a key at <a className="text-primary underline" href="https://x.ai/api" target="_blank" rel="noreferrer">x.ai/api</a>. Stored locally in the SQLite DB; never sent back to non-admin users.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Grok model
                </label>
                <select
                  value={grokModel}
                  onChange={(e) => setGrokModel(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="grok-2-latest">grok-2-latest (recommended)</option>
                  <option value="grok-2">grok-2</option>
                  <option value="grok-2-mini">grok-2-mini (cheaper)</option>
                  <option value="grok-beta">grok-beta</option>
                  <option value="grok-3-latest">grok-3-latest (if available)</option>
                </select>
              </div>
            </div>
          )}

          {/* OpenAI */}
          {provider === "openai" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  OpenAI API key
                </label>
                <div className="relative">
                  <input
                    type={showOpenaiKey ? "text" : "password"}
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showOpenaiKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1 text-[0.65rem] text-muted-foreground">
                  Get a key at <a className="text-primary underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>. Stored locally in the SQLite DB; never sent back to non-admin users.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  OpenAI model
                </label>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (cheap, fast)</option>
                  <option value="gpt-4o">gpt-4o (best quality)</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo (cheapest)</option>
                  <option value="o1-mini">o1-mini (reasoning)</option>
                  <option value="o1">o1 (reasoning, expensive)</option>
                </select>
              </div>
            </div>
          )}

          {/* Azure / Microsoft Foundry */}
          {provider === "azure" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
              <p className="text-[0.7rem] text-muted-foreground">
                Deploy a chat model in <a className="text-primary underline" href="https://ai.azure.com" target="_blank" rel="noreferrer">Microsoft Foundry</a>, then copy its endpoint + key + deployment name below. Recommended for this app: <code className="font-mono">gpt-4o-mini</code>. The app uses the OpenAI-compatible <code className="font-mono">/openai/v1/chat/completions</code> API.
              </p>
              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[0.7rem] text-amber-300">
                You can paste either the project/resource endpoint or a full Foundry URL such as <code className="font-mono">.../openai/v1/responses</code>. The app will normalize it automatically. For lowest cost and simplest compatibility, prefer <code className="font-mono">gpt-4o-mini</code> over reasoning models like <code className="font-mono">o4-mini</code>.
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Endpoint</label>
                <input
                  type="text"
                  value={azureEndpoint}
                  onChange={(e) => setAzureEndpoint(e.target.value)}
                  placeholder="https://your-resource.openai.azure.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                />
                <p className="mt-1 text-[0.65rem] text-muted-foreground">Your resource endpoint — e.g. <code className="font-mono">https://&lt;name&gt;.openai.azure.com</code> or <code className="font-mono">https://&lt;name&gt;.services.ai.azure.com</code>. Paste the base; we add the rest.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">API key</label>
                <div className="relative">
                  <input
                    type={showAzureKey ? "text" : "password"}
                    value={azureKey}
                    onChange={(e) => setAzureKey(e.target.value)}
                    placeholder="Your Azure / Foundry key"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm font-mono"
                  />
                  <button type="button" onClick={() => setShowAzureKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground">
                    {showAzureKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-1 text-[0.65rem] text-muted-foreground">Stored locally in the SQLite DB; never sent back to non-admin users.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Deployment name</label>
                  <input
                    type="text"
                    value={azureModel}
                    onChange={(e) => setAzureModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">The name you gave the deployment in Foundry.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">API version (legacy)</label>
                  <input
                    type="text"
                    value={azureApiVersion}
                    onChange={(e) => setAzureApiVersion(e.target.value)}
                    placeholder="v1"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">Foundry <code className="font-mono">/openai/v1</code> calls do not allow an <code className="font-mono">api-version</code> query. This value is kept only for older saved settings.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── AI Configuration ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {provider === "ollama" ? "Ollama Configuration" : "Local Ollama Settings"}
        </h2>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
          {/* Ollama URL */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Ollama URL</label>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full max-w-md"
              placeholder="http://localhost:11434"
            />
          </div>

          {/* Enable AI */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Enable AI Feedback</label>
              <p className="text-xs text-muted-foreground">Provide AI-powered pronunciation feedback</p>
            </div>
            <Switch checked={enableAI} onCheckedChange={setEnableAI} ariaLabel="Enable AI feedback" />
          </div>

          {/* Allow Student Choice */}
          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Allow Students to Choose Model</label>
              <p className="text-xs text-muted-foreground">Let students pick which AI model provides feedback</p>
            </div>
            <Switch checked={allowStudentChoice} onCheckedChange={setAllowStudentChoice} ariaLabel="Allow students to choose model" />
          </div>

          {/* AI Conversation Input Mode */}
          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">AI Conversation Input Mode</label>
            <p className="text-xs text-muted-foreground mb-2">
              Control how students interact with the AI tutor on the AI Conversation page.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "both" as const, label: "Both", desc: "Voice + text" },
                { id: "voice" as const, label: "Voice only", desc: "Force speaking practice" },
                { id: "text" as const, label: "Text only", desc: "Reading + writing" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setConversationInputMode(opt.id)}
                  className={`rounded-md border p-3 text-left transition ${
                    conversationInputMode === opt.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <div className={`text-sm font-medium ${conversationInputMode === opt.id ? "text-primary" : "text-foreground"}`}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[0.7rem] text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Scenario Scoring Mode */}
          <div className="max-w-2xl">
            <label className="text-sm font-medium text-foreground">Scenario Scoring Mode</label>
            <p className="text-xs text-muted-foreground mb-2">
              Decide whether role-play criteria are checked only at the end or updated while students speak.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  id: "manual" as const,
                  label: "Manual finish",
                  desc: "Students click Finish & Score when they are done.",
                },
                {
                  id: "live" as const,
                  label: "Live progress",
                  desc: "Criteria update after each answer and passing scenarios auto-save.",
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setScenarioScoringMode(opt.id)}
                  className={`rounded-md border p-3 text-left transition ${
                    scenarioScoringMode === opt.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <div className={`text-sm font-medium ${scenarioScoringMode === opt.id ? "text-primary" : "text-foreground"}`}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[0.7rem] text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Active Model Selector */}
          {models.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Active Model</label>
              <select
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full max-w-md"
              >
                <option value="">Select a model</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({(m.size / 1e9).toFixed(1)} GB)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Pronunciation Prompt */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              System Prompt for Pronunciation Feedback
            </label>
            <textarea
              value={pronunciationPrompt}
              onChange={(e) => setPronunciationPrompt(e.target.value)}
              rows={3}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full resize-y"
            />
          </div>

          {/* Speaking Prompt */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              System Prompt for Speaking Feedback
            </label>
            <textarea
              value={speakingPrompt}
              onChange={(e) => setSpeakingPrompt(e.target.value)}
              rows={3}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full resize-y"
            />
          </div>

          {/* Temperature */}
          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">
              Temperature: {temperature.toFixed(1)}
            </label>
            <p className="text-xs text-muted-foreground mb-1">
              Lower = more focused, higher = more creative
            </p>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0 (Focused)</span>
              <span>1 (Creative)</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div className="max-w-md">
            <label className="block text-sm font-medium text-foreground mb-1.5">Max Tokens</label>
            <input
              type="number"
              min={50}
              max={500}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-32"
            />
            <p className="text-xs text-muted-foreground mt-1">Max length of AI response (50-500)</p>
          </div>

          {/* Response Style */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Response Style</label>
            <select
              value={responseStyle}
              onChange={(e) => setResponseStyle(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full max-w-xs"
            >
              <option value="Encouraging">Encouraging</option>
              <option value="Neutral">Neutral</option>
              <option value="Strict">Strict</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">Tone of AI feedback responses</p>
          </div>

          {/* Save */}
          <div className="pt-2">
            <div className="flex flex-wrap items-center gap-3">
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
              <button
                onClick={handleTestProvider}
                disabled={testingProvider || saving}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition disabled:opacity-50"
              >
                {testingProvider ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                {testingProvider ? "Testing..." : "Test AI Provider"}
              </button>
            </div>
            {providerTestResult && (
              <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${providerTestResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
                {providerTestResult.message}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

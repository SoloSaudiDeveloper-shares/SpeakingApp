"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Volume2, Loader2, ArrowLeft, Check, Save, Play, Sparkles } from "lucide-react"
import { getTtsEngine } from "@/lib/speech/tts-factory"
import { TTS_ENGINE_OPTIONS, type TtsEngineId, type TtsVoice } from "@/lib/speech/tts-engines/types"
import { cn } from "@/lib/utils/cn"
import { Switch } from "@/components/shared/switch"

function qualityColor(q: string) {
  if (q === "Excellent") return "bg-emerald-500/20 text-emerald-400"
  if (q === "Very good") return "bg-blue-500/20 text-blue-400"
  return "bg-yellow-500/20 text-yellow-400"
}

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>{label}</span>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout))
  })
}

export default function TTSSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [activeTTS, setActiveTTS] = useState<TtsEngineId>("kokoro")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [voiceMode, setVoiceMode] = useState<"local" | "system">("local")

  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState("")

  const [speed, setSpeed] = useState(0.9)
  const [volume, setVolume] = useState(1.0)
  const [autoPlay, setAutoPlay] = useState(true)
  const [repeatCount, setRepeatCount] = useState(1)
  const [allowStudentChoice, setAllowStudentChoice] = useState(false)
  // Persisted for backward compatibility with earlier settings; the UI now
  // exposes system voice through the two-choice selector above the engine cards.
  const [showSystemVoice, setShowSystemVoice] = useState(false)

  // Load saved settings once.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/settings")
        if (res.ok) {
          const s = await res.json()
          if (s.active_tts_model) {
            setActiveTTS(s.active_tts_model as TtsEngineId)
            setVoiceMode(s.active_tts_model === "browser-tts" ? "system" : "local")
          }
          if (s.tts_default_voice) setSelectedVoice(s.tts_default_voice)
          if (s.tts_default_rate) setSpeed(Number(s.tts_default_rate))
          if (s.tts_default_volume) setVolume(Number(s.tts_default_volume))
          if (s.tts_auto_play !== undefined) setAutoPlay(s.tts_auto_play === "true")
          if (s.tts_repeat_count) setRepeatCount(Number(s.tts_repeat_count))
          if (s.tts_allow_student_choice !== undefined) setAllowStudentChoice(s.tts_allow_student_choice === "true")
          if (s.tts_show_system_voice !== undefined) setShowSystemVoice(s.tts_show_system_voice === "true")
        }
      } catch { /* ignore */ }
      setLoading(false)
    }
    load()
  }, [])

  // Load the active engine's voices whenever the engine changes.
  useEffect(() => {
    if (loading) return
    let cancelled = false
    setVoicesLoading(true)
    getTtsEngine(activeTTS).listVoices()
      .then((vs) => {
        if (cancelled) return
        setVoices(vs)
        setSelectedVoice((cur) => (vs.some((v) => v.id === cur) ? cur : (vs[0]?.id ?? "")))
      })
      .catch(() => { if (!cancelled) setVoices([]) })
      .finally(() => { if (!cancelled) setVoicesLoading(false) })
    return () => { cancelled = true }
  }, [activeTTS, loading])

  const saveSetting = async (key: string, value: string) => {
    try {
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) })
    } catch { /* ignore */ }
  }

  const activateModel = async (id: TtsEngineId) => {
    setActiveTTS(id); setTestError(null)
    setVoiceMode(id === "browser-tts" ? "system" : "local")
    if (id === "browser-tts") setShowSystemVoice(true)
    await saveSetting("active_tts_model", id)
  }

  const handleSave = async () => {
    setSaving(true)
    await Promise.all([
      saveSetting("active_tts_model", activeTTS),
      saveSetting("tts_default_voice", selectedVoice),
      saveSetting("tts_default_rate", String(speed)),
      saveSetting("tts_default_volume", String(volume)),
      saveSetting("tts_allow_student_choice", String(allowStudentChoice)),
      saveSetting("tts_auto_play", String(autoPlay)),
      saveSetting("tts_repeat_count", String(repeatCount)),
      saveSetting("tts_show_system_voice", String(showSystemVoice)),
    ])
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    setTesting(true); setTestError(null)
    const engine = getTtsEngine(activeTTS)
    try {
      await withTimeout(
        engine.speak("Hello! This is a preview of the selected voice.", {
          voice: selectedVoice || null, rate: speed, volume,
        }),
        activeTTS === "kokoro" ? 45000 : 15000,
        `${engine.name} did not finish the voice preview in time. Try a shorter test, another voice, or the browser/system voice.`,
      )
    } catch (e) {
      try { engine.cancel() } catch { /* ignore */ }
      setTestError(e instanceof Error ? e.message : "Could not play this voice.")
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  const visibleTtsOptions = TTS_ENGINE_OPTIONS.filter((m) =>
    voiceMode === "system" ? m.id === "browser-tts" : m.id !== "browser-tts",
  )

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/models" className="text-muted-foreground hover:text-foreground transition"><ArrowLeft size={20} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Voice (Text-to-Speech)</h1>
          <p className="text-sm text-muted-foreground">Choose the voice students hear during practice. Local neural voices are the default; system voices are available for device-level fallback.</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setVoiceMode("local")}
          className={cn("rounded-xl border p-5 text-left transition", voiceMode === "local" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20")}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Local neural voice</h2>
              <p className="mt-1 text-sm text-muted-foreground">Kokoro and bundled offline voices. Best default for lessons because it works without cloud setup.</p>
            </div>
            {voiceMode === "local" && <Check size={18} className="text-primary" />}
          </div>
        </button>
        <button
          onClick={() => {
            setVoiceMode("system")
            setShowSystemVoice(true)
          }}
          className={cn("rounded-xl border p-5 text-left transition", voiceMode === "system" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/20")}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">System / device voice</h2>
              <p className="mt-1 text-sm text-muted-foreground">Uses the operating system voice as a fallback. Quality depends on the installed Windows voices.</p>
            </div>
            {voiceMode === "system" && <Check size={18} className="text-primary" />}
          </div>
        </button>
      </section>

      {/* Engine cards */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-1">{voiceMode === "local" ? "Local voice engines" : "System voice engine"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {voiceMode === "local"
            ? "These voices run inside the app and are the recommended setup for student practice."
            : "This option is useful as a fallback, but it may sound less natural than the bundled neural voice."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleTtsOptions.map((m) => {
            const active = activeTTS === m.id
            return (
              <div key={m.id} className={cn("rounded-xl border p-5 shadow-sm transition", active ? "border-primary bg-primary/5 shadow-md shadow-primary/10" : "border-border bg-card hover:border-border/80")}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      {m.id === "kokoro" && <Sparkles size={13} className="text-primary" />}{m.name}
                    </h3>
                  </div>
                  {active && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary"><Check size={12} className="text-primary-foreground" /></span>}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge label={m.quality} className={qualityColor(m.quality)} />
                  <Badge label={m.speed} className="bg-muted text-muted-foreground" />
                  <Badge label={m.bundled ? "Bundled · offline" : "Offline"} className="bg-emerald-500/20 text-emerald-400" />
                  {m.id === "kokoro" && <Badge label="Recommended" className="bg-primary/20 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground mb-3 min-h-[3rem]">{m.description}</p>
                <div className="text-[11px] text-muted-foreground mb-3">{m.size}</div>
                <button onClick={() => activateModel(m.id)} className={cn("w-full rounded-md px-3 py-2 text-xs font-semibold transition", active ? "bg-primary/20 text-primary cursor-default" : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground")}>
                  {active ? "Active" : "Activate"}
                </button>
              </div>
            )
          })}
        </div>

      </section>

      {/* Voice + settings */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Voice settings</h2>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5 flex items-center gap-2">
              <Volume2 size={14} /> Voice {voicesLoading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            </label>
            <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full max-w-md">
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              {voices.length === 0 && <option value="">{voicesLoading ? "Loading voices…" : "No voices available"}</option>}
            </select>
          </div>

          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">Speed: {speed.toFixed(1)}x</label>
            <input type="range" min={0.5} max={2.0} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full accent-primary mt-1" />
          </div>

          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">Volume: {(volume * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={1.0} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-primary mt-1" />
          </div>

          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Allow students to choose their own voice</label>
              <p className="text-xs text-muted-foreground">When off, your settings above are used for everyone.</p>
            </div>
            <Switch checked={allowStudentChoice} onCheckedChange={setAllowStudentChoice} ariaLabel="Allow students to choose their own voice" />
          </div>

          <div className="flex items-center justify-between max-w-md">
            <div>
              <label className="text-sm font-medium text-foreground">Auto-play on new word</label>
              <p className="text-xs text-muted-foreground">Automatically speak when a new word appears.</p>
            </div>
            <Switch checked={autoPlay} onCheckedChange={setAutoPlay} ariaLabel="Auto-play on new word" />
          </div>

          <div className="max-w-md">
            <label className="text-sm font-medium text-foreground">Repeat count</label>
            <p className="text-xs text-muted-foreground mb-2">How many times to repeat the word when playing.</p>
            <div className="flex items-center gap-3">
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => setRepeatCount(n)} className={cn("flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold transition", repeatCount === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{n}</button>
              ))}
            </div>
          </div>

          {testError && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{testError}</div>}

          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleTest} disabled={testing} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition disabled:opacity-50">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {testing ? (activeTTS === "kokoro" ? "Loading voice…" : "Playing…") : "Test Voice"}
            </button>
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

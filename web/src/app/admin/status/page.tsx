"use client"

import { useState, useEffect } from "react"
import { Activity, Database, Settings, Loader2, RefreshCw, Mic, AlertTriangle } from "lucide-react"

interface SpeechReliabilityReport {
  kpis: {
    sttSuccessRate: number
    azurePronunciationAvailability: number
    averageLatencyMs: number
    p95LatencyMs: number
    failedRecordings: number
    noSpeechAttempts: number
    totalEvents: number
  }
}

export default function AdminStatusPage() {
  const [status, setStatus] = useState<{ ollamaOnline: boolean; settings: Array<{ key: string; value: string }> } | null>(null)
  const [speech, setSpeech] = useState<SpeechReliabilityReport | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [aiRes, settingsRes] = await Promise.all([
        fetch("/api/ai/status"),
        fetch("/api/settings"),
      ])
      const ai = await aiRes.json()
      const settings = await settingsRes.json()
      setStatus({ ollamaOnline: ai.online, settings: settings.settings ?? [] })
      fetch("/api/reports/speech-reliability")
        .then((res) => res.ok ? res.json() : null)
        .then((result) => setSpeech(result))
        .catch(() => setSpeech(null))
    } catch {
      setStatus(null)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">System Status</h1>
        <button onClick={load} className="text-muted-foreground hover:text-foreground transition"><RefreshCw size={18} /></button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={`rounded-lg border p-4 shadow-sm ${status?.ollamaOnline ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          <div className="flex items-center gap-2">
            <Activity size={16} className={status?.ollamaOnline ? "text-emerald-400" : "text-red-400"} />
            <span className="text-sm font-medium text-foreground">Ollama</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status?.ollamaOnline ? "Connected at localhost:11434" : "Not reachable"}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-emerald-400" />
            <span className="text-sm font-medium text-foreground">Database</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">SQLite (better-sqlite3) - Connected</p>
        </div>
      </div>

      {speech && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mic size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Speech Reliability</h2>
            </div>
            {(speech.kpis.sttSuccessRate < 0.85 || speech.kpis.azurePronunciationAvailability < 0.85 || speech.kpis.noSpeechAttempts > 0) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                <AlertTriangle size={12} /> Needs review
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-background/45 p-3">
              <p className="text-xs text-muted-foreground">STT success</p>
              <p className="mt-1 text-xl font-bold text-foreground">{Math.round(speech.kpis.sttSuccessRate * 100)}%</p>
            </div>
            <div className="rounded-lg border border-border bg-background/45 p-3">
              <p className="text-xs text-muted-foreground">Azure pronunciation</p>
              <p className="mt-1 text-xl font-bold text-foreground">{Math.round(speech.kpis.azurePronunciationAvailability * 100)}%</p>
            </div>
            <div className="rounded-lg border border-border bg-background/45 p-3">
              <p className="text-xs text-muted-foreground">Latency p95</p>
              <p className="mt-1 text-xl font-bold text-foreground">{speech.kpis.p95LatencyMs}ms</p>
            </div>
            <div className="rounded-lg border border-border bg-background/45 p-3">
              <p className="text-xs text-muted-foreground">No speech</p>
              <p className="mt-1 text-xl font-bold text-foreground">{speech.kpis.noSpeechAttempts}</p>
            </div>
          </div>
        </div>
      )}

      {status?.settings && status.settings.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Settings size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">App Settings</h2>
          </div>
          <div className="space-y-2">
            {status.settings.map((s) => (
              <div key={s.key} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-mono text-xs">{s.key}</span>
                <span className="text-foreground">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

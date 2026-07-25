"use client"

import { useState, useEffect } from "react"
import { Activity, Database, Settings, Loader2, RefreshCw, Mic, AlertTriangle, Send } from "lucide-react"

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

interface XapiStatus {
  enabled: boolean
  configured: boolean
  sourceApp: string
  actorHomepage: string
  configurationError: string | null
  counts: Record<string, number>
  recentFailures: Array<{ statementId: string; actorSubject: string; verb: string; attempts: number; lastError: string; nextAttemptAt: string }>
}

export default function AdminStatusPage() {
  const [status, setStatus] = useState<{ ollamaOnline: boolean; settings: Array<{ key: string; value: string }> } | null>(null)
  const [speech, setSpeech] = useState<SpeechReliabilityReport | null>(null)
  const [xapi, setXapi] = useState<XapiStatus | null>(null)
  const [retryingXapi, setRetryingXapi] = useState(false)
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
      fetch("/api/admin/integrations/xapi/status")
        .then((res) => res.ok ? res.json() : null)
        .then((result) => setXapi(result))
        .catch(() => setXapi(null))
    } catch {
      setStatus(null)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function retryXapi() {
    setRetryingXapi(true)
    await fetch("/api/admin/integrations/xapi/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null)
    setTimeout(() => { void load(); setRetryingXapi(false) }, 800)
  }

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
          <p className="mt-1 text-xs text-muted-foreground">PostgreSQL 17 — readiness monitored</p>
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

      {xapi && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Send size={16} className="mt-0.5 text-primary" />
              <div><h2 className="text-sm font-semibold text-foreground">SAIF xAPI outbox</h2><p className="mt-1 text-xs text-muted-foreground">{xapi.enabled ? xapi.configured ? `Enabled · ${xapi.sourceApp} · ${xapi.actorHomepage}` : "Enabled but not fully configured" : "Disabled by XAPI_ENABLED"}</p></div>
            </div>
            <button onClick={retryXapi} disabled={retryingXapi || !(xapi.counts.failed > 0)} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40">{retryingXapi ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry failures</button>
          </div>
          {xapi.configurationError && <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{xapi.configurationError}</p>}
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{["pending", "sent", "failed"].map((key) => <div key={key} className="rounded-lg border border-border bg-background/45 p-3"><p className="text-xs capitalize text-muted-foreground">{key}</p><p className="mt-1 text-xl font-bold text-foreground">{xapi.counts[key] ?? 0}</p></div>)}</div>
          {xapi.recentFailures.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent failures</p>{xapi.recentFailures.map((failure) => <div key={failure.statementId} className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-foreground">{failure.statementId}</span><span className="text-amber-300">attempt {failure.attempts}</span></div><p className="mt-1 text-muted-foreground">{failure.lastError}</p></div>)}</div>}
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

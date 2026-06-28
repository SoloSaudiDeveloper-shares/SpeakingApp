"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Mic, Volume2, Brain, Waves, Loader2, ArrowRight, CheckCircle2, AlertTriangle, WifiOff } from "lucide-react"
import { STT_ENGINE_OPTIONS } from "@/lib/speech/types"
import { TTS_ENGINE_OPTIONS } from "@/lib/speech/tts-engines/types"

type Status = "active" | "online" | "configured" | "warn" | "off"

function StatusPill({ status, label }: { status: Status; label: string }) {
  const map: Record<Status, string> = {
    active: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    online: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    configured: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
    warn: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
    off: "bg-muted text-muted-foreground ring-border",
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${map[status]}`}>{label}</span>
}

interface CardProps {
  href: string; icon: React.ElementType; accent: string; title: string; subtitle: string
  status: Status; statusLabel: string; lines: { k: string; v: string }[]
}
function SettingCard({ href, icon: Icon, accent, title, subtitle, status, statusLabel, lines }: CardProps) {
  return (
    <Link href={href} className="group rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-foreground/20">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}><Icon size={18} /></div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <StatusPill status={status} label={statusLabel} />
      </div>
      <dl className="space-y-1.5">
        {lines.map((l) => (
          <div key={l.k} className="flex items-center justify-between gap-2 text-xs">
            <dt className="text-muted-foreground">{l.k}</dt>
            <dd className="truncate font-medium text-foreground/90">{l.v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary group-hover:translate-x-0.5 transition-transform">
        Configure <ArrowRight size={12} />
      </div>
    </Link>
  )
}

export default function AdminModelsPage() {
  const [loading, setLoading] = useState(true)
  const [s, setS] = useState<Record<string, string>>({})
  const [aiOnline, setAiOnline] = useState(false)
  const [aiProvider, setAiProvider] = useState("")
  const [aiModel, setAiModel] = useState("")
  const [aiDetail, setAiDetail] = useState("")

  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, statusRes] = await Promise.all([
          fetch("/api/settings").catch(() => null),
          fetch("/api/ai/status").catch(() => null),
        ])
        if (settingsRes?.ok) setS(await settingsRes.json())
        if (statusRes?.ok) {
          const st = await statusRes.json()
          setAiOnline(!!st.online)
          setAiProvider(st.provider ?? "")
          setAiModel(st.model ?? "")
          setAiDetail(st.detail ?? "")
        }
      } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>

  const sttId = s.active_stt_model || "groq-whisper"
  const sttName = STT_ENGINE_OPTIONS.find((o) => o.id === sttId)?.name ?? sttId
  const fallbackOn = s.stt_allow_offline_fallback !== "false"
  const azureOn = !!s.azure_speech_key
  const ttsId = s.active_tts_model || "kokoro"
  const ttsName = TTS_ENGINE_OPTIONS.find((o) => o.id === ttsId)?.name ?? ttsId
  const ttsVoice = s.tts_default_voice || "default"

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI &amp; Speech</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything that powers recording, scoring, and the voice. These defaults apply across the whole app — practice, fluency drills, and the diagnostic.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SettingCard
          href="/admin/models/stt" icon={Mic} accent="bg-blue-500/10 text-blue-400"
          title="Speech recognition" subtitle="Turns the student's speech into text"
          status="active" statusLabel="Active"
          lines={[
            { k: "Engine", v: sttName },
            { k: "Offline fallback", v: fallbackOn ? "On (bundled Whisper)" : "Off" },
          ]}
        />
        <SettingCard
          href="/admin/models/stt" icon={Waves} accent="bg-rose-500/10 text-rose-400"
          title="Pronunciation accuracy" subtitle="Phoneme-level scoring (Azure)"
          status={azureOn ? "configured" : "warn"} statusLabel={azureOn ? "Active" : "Not set up"}
          lines={[
            { k: "Provider", v: "Azure AI Speech" },
            { k: "Region", v: azureOn ? (s.azure_speech_region || "eastus") : "—" },
          ]}
        />
        <SettingCard
          href="/admin/models/tts" icon={Volume2} accent="bg-emerald-500/10 text-emerald-400"
          title="Voice (text-to-speech)" subtitle="The voice students hear and imitate"
          status="active" statusLabel="Active"
          lines={[
            { k: "Engine", v: ttsName },
            { k: "Voice", v: ttsVoice },
          ]}
        />
        <SettingCard
          href="/admin/models/ai" icon={Brain} accent="bg-purple-500/10 text-purple-400"
          title="AI feedback &amp; conversation" subtitle="Chat partner + scenario scoring"
          status={aiOnline ? "online" : "off"} statusLabel={aiOnline ? "Online" : "Offline"}
          lines={[
            { k: "Provider", v: aiProvider || "—" },
            { k: "Model", v: aiModel || "—" },
          ]}
        />
      </div>

      {/* Health hints */}
      <div className="space-y-2">
        {!azureOn && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Add an <strong>Azure Speech key</strong> in Speech recognition for real phoneme-level pronunciation scoring — the biggest boost to feedback accuracy.</span>
          </div>
        )}
        {!aiOnline && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <WifiOff size={15} className="mt-0.5 shrink-0" />
            <span>
              AI feedback is offline. {aiDetail ? `${aiDetail} ` : ""}
              Set a provider + key in <Link href="/admin/models/ai" className="underline">AI settings</Link> (Groq is free).
            </span>
          </div>
        )}
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
          <span>Changes here apply everywhere automatically — no need to set them per page.</span>
        </div>
      </div>
    </div>
  )
}

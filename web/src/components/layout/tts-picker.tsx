"use client"

import { useEffect, useState } from "react"
import { Volume2, Play, RotateCcw, Loader2 } from "lucide-react"
import { speak, isStudentTtsChoiceAllowed, getEffectiveTtsSettings, setStudentTtsOverride, getActiveTtsEngineId, type TtsSettings } from "@/lib/speech/tts"
import { getTtsEngine } from "@/lib/speech/tts-factory"
import type { TtsVoice } from "@/lib/speech/tts-engines/types"

export function TtsPicker() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [settings, setSettings] = useState<TtsSettings>({ voice: null, rate: 0.9, pitch: 1.0, volume: 1.0 })
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    (async () => {
      const ok = await isStudentTtsChoiceAllowed()
      setAllowed(ok)
      const engineId = await getActiveTtsEngineId()
      const vs = await getTtsEngine(engineId).listVoices()
      setVoices(vs)
      const eff = await getEffectiveTtsSettings()
      setSettings(eff)
    })()
  }, [])

  const update = <K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    setStudentTtsOverride({ [key]: value } as Partial<TtsSettings>)
  }

  const handleTest = async () => {
    setTesting(true)
    await speak("Hello! This is a preview of your selected voice.")
    setTesting(false)
  }

  const handleReset = () => {
    if (typeof window === "undefined") return
    localStorage.removeItem("tts-voice")
    localStorage.removeItem("tts-rate")
    localStorage.removeItem("tts-pitch")
    localStorage.removeItem("tts-volume")
    getEffectiveTtsSettings().then(setSettings)
  }

  if (allowed === null) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading...</div>
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Volume2 size={14} className="inline mr-1.5" />
        Voice settings are managed by your administrator.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Volume2 size={14} /> Voice
        </label>
        <select
          value={settings.voice ?? ""}
          onChange={(e) => update("voice", e.target.value || null)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Default</option>
          {voices.map(v => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Speed: {settings.rate.toFixed(1)}x</label>
        <input
          type="range"
          min={0.5} max={2.0} step={0.1}
          value={settings.rate}
          onChange={(e) => update("rate", Number(e.target.value))}
          className="w-full accent-primary mt-1"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Pitch: {settings.pitch.toFixed(1)}</label>
        <input
          type="range"
          min={0.5} max={2.0} step={0.1}
          value={settings.pitch}
          onChange={(e) => update("pitch", Number(e.target.value))}
          className="w-full accent-primary mt-1"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Volume: {Math.round(settings.volume * 100)}%</label>
        <input
          type="range"
          min={0} max={1.0} step={0.05}
          value={settings.volume}
          onChange={(e) => update("volume", Number(e.target.value))}
          className="w-full accent-primary mt-1"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {testing ? "Playing..." : "Test Voice"}
        </button>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm"
        >
          <RotateCcw size={14} /> Reset to default
        </button>
      </div>
    </div>
  )
}

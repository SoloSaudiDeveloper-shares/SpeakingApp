"use client"

import { useEffect, useState } from "react"
import { WifiOff, X } from "lucide-react"

/**
 * App-wide corner popup shown when speech recognition falls back from the Groq
 * cloud to the bundled offline Whisper model. Listens for the global
 * `stt-fallback` event dispatched by GroqWhisperEngine.
 */
export function SttFallbackToast() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { reason?: string } | undefined
      setMsg(detail?.reason ?? "Switched to the offline voice model.")
    }
    window.addEventListener("stt-fallback", handler)
    return () => window.removeEventListener("stt-fallback", handler)
  }, [])

  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 6000)
    return () => clearTimeout(t)
  }, [msg])

  if (!msg) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-xs transition-all">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2.5 shadow-xl backdrop-blur">
        <WifiOff size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-400">Offline speech recognition</p>
          <p className="mt-0.5 text-xs text-foreground/80">{msg}</p>
        </div>
        <button onClick={() => setMsg(null)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

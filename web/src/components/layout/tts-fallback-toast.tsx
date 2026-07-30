"use client"

import { useEffect, useState } from "react"
import { TriangleAlert, Volume2, X } from "lucide-react"

interface TtsFallbackDetail {
  from?: string
  to?: string | null
  reason?: string
}

/**
 * App-wide, visible TTS degradation notice. Synthesis errors must not look like
 * a completed utterance or leave the learner wondering why the tutor is quiet.
 */
export function TtsFallbackToast() {
  const [detail, setDetail] = useState<TtsFallbackDetail | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      setDetail((event as CustomEvent<TtsFallbackDetail>).detail ?? {
        to: null,
        reason: "Voice playback failed.",
      })
    }
    window.addEventListener("tts-fallback", handler)
    return () => window.removeEventListener("tts-fallback", handler)
  }, [])

  useEffect(() => {
    if (!detail) return
    const timeout = setTimeout(() => setDetail(null), detail.to ? 7_000 : 12_000)
    return () => clearTimeout(timeout)
  }, [detail])

  if (!detail) return null
  const failed = detail.to == null

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[100] sm:left-auto sm:max-w-sm"
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
    >
      <div className={[
        "flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur",
        failed
          ? "border-destructive/40 bg-destructive/15"
          : "border-amber-500/40 bg-amber-500/15",
      ].join(" ")}>
        {failed
          ? <TriangleAlert className="mt-1 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          : <Volume2 className="mt-1 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {failed ? "Voice playback failed" : "Backup voice in use"}
          </p>
          <p className="mt-0.5 text-xs text-foreground/80">
            {detail.reason || (failed
              ? "The audio could not be delivered. You can continue with the on-screen text."
              : `The preferred voice was unavailable, so Speaking Lab switched to ${detail.to}.`)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDetail(null)}
          aria-label="Dismiss voice notification"
          className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background/40 hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

"use client"

/**
 * Live transcription preview for BATCH speech engines (Groq cloud Whisper) that
 * don't stream. The Web Speech API can emit interim words while you talk; cloud
 * Whisper only returns text after you stop. To still show words as the learner
 * speaks, this runs a parallel recorder on the mic stream and, every few
 * seconds, transcribes the audio captured SO FAR via /api/stt/transcribe and
 * surfaces the accumulating transcript.
 *
 * Display-only: the FINAL scored transcript still comes from the engine's
 * stop(), which transcribes the complete recording (and applies the silence
 * gate). This is admin-toggleable (`stt_live_preview`) and only makes sense for
 * the cloud engine — it deliberately uses the network, so it's off for offline
 * engines.
 */

export interface LivePreviewHandle {
  stop: () => void
}

export function startLivePreview(
  stream: MediaStream,
  onText: (text: string) => void,
  opts: { intervalMs?: number } = {},
): LivePreviewHandle {
  const intervalMs = opts.intervalMs ?? 5000
  let active = true
  let busy = false
  const chunks: Blob[] = []
  let recorder: MediaRecorder | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  try {
    recorder = new MediaRecorder(
      stream,
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined,
    )
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.start(1000)
  } catch {
    active = false
  }

  const tick = async () => {
    if (!active || busy || chunks.length === 0) return
    busy = true
    try {
      // Re-transcribe everything captured so far → a clean, gap-free, growing
      // transcript. The blob always carries the webm header (first chunk), so it
      // decodes correctly server-side.
      const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" })
      const form = new FormData()
      form.append("file", blob, "audio.webm")
      const res = await fetch("/api/stt/transcribe", { method: "POST", body: form })
      if (res.ok && active) {
        const data = await res.json()
        const t = String(data.transcript ?? "").trim()
        if (t) onText(t)
      }
    } catch {
      /* preview is best-effort — never disrupt the recording */
    } finally {
      busy = false
    }
  }

  timer = setInterval(tick, intervalMs)

  return {
    stop: () => {
      active = false
      if (timer) { clearInterval(timer); timer = null }
      try { recorder?.stop() } catch { /* ignore */ }
    },
  }
}

"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Timer, Mic, MicOff, Loader2, ArrowRight, TrendingUp, TrendingDown, Minus, Shuffle, RotateCcw, Trophy } from "lucide-react"
import { getSpeechEngine, getDefaultEngine } from "@/lib/speech/speech-factory"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { startLivePreview, type LivePreviewHandle } from "@/lib/speech/live-preview"
import { computeFluencyMetrics, scoreMonologueImprovement, monologueSufficiency, scoreContentQuality, type FluencyMetrics } from "@/lib/scoring"
import { AudioVisualizer } from "@/components/shared/audio-visualizer"
import { topicsForBand, type CefrBand, type MonologueTopic } from "@/lib/fluency/monologue-topics"
import { recordClientSpeechReliabilityEvent } from "@/lib/speech/reliability-client"

const ROUND_LIMITS = [90, 60, 40] // seconds — the classic 4/3/2 (scaled to 90/60/40)

interface RoundResult {
  round: number
  limitSeconds: number
  actualSeconds: number
  transcript: string
  metrics: FluencyMetrics
  /** True when too little was said to be a valid fluent monologue (e.g. "yo yo"). */
  tooShort: boolean
  /** True when the speech was repetitive / incoherent / off-topic (not real content). */
  lowContent: boolean
}

type Phase = "topic" | "ready" | "recording" | "round-summary" | "final"

export default function MonologuePage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("topic")
  const [cefr, setCefr] = useState<CefrBand>("A1")
  const [topic, setTopic] = useState<MonologueTopic | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const [results, setResults] = useState<RoundResult[]>([])
  const [recording, setRecording] = useState(false)
  const [timeLeft, setTimeLeft] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cycleId, setCycleId] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)

  const engineRef = useRef<SpeechEngine | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const interimUnsubRef = useRef<(() => void) | null>(null)
  const livePreviewRef = useRef<LivePreviewHandle | null>(null)
  const liveEnabledRef = useRef(true) // admin setting stt_live_preview (default on)
  const pauseEventsRef = useRef<{ at: number; durationMs: number }[]>([])
  const lastInterimRef = useRef(0)
  const startRef = useRef(0)

  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()
    fetch("/api/practice").then(r => r.json()).then(d => {
      if (d?.book?.cefrLevel) setCefr(d.book.cefrLevel as CefrBand)
      if (d?.cycle?.id) setCycleId(d.cycle.id)
    }).catch(() => {})
    fetch("/api/settings").then(r => r.json()).then(s => {
      liveEnabledRef.current = s?.stt_live_preview !== "false" // default ON
    }).catch(() => {})
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (interimUnsubRef.current) interimUnsubRef.current()
      livePreviewRef.current?.stop()
      engineRef.current?.stop?.().catch(() => {})
    }
  }, [])

  const pickTopic = (t: MonologueTopic) => { setTopic(t); setPhase("ready") }
  const pickRandom = () => {
    const list = topicsForBand(cefr)
    pickTopic(list[Math.floor(list.length * 0.5)] ?? list[0])
  }

  const startRound = useCallback(async () => {
    setMicError(null); setLiveTranscript("")
    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
      setMicStream(engineRef.current.getStream())
      setRecording(true)
      setPhase("recording")

      pauseEventsRef.current = []
      startRef.current = Date.now()
      lastInterimRef.current = Date.now()
      if (engineRef.current.onInterim) {
        // Web Speech streams interim words natively.
        interimUnsubRef.current = engineRef.current.onInterim((t) => {
          const now = Date.now()
          const gap = now - lastInterimRef.current
          if (gap >= 500 && lastInterimRef.current > startRef.current) {
            pauseEventsRef.current.push({ at: now - startRef.current, durationMs: gap })
          }
          lastInterimRef.current = now
          setLiveTranscript(t)
        })
      } else if (liveEnabledRef.current && engineRef.current.name === "Groq Whisper (cloud)") {
        // Cloud Whisper can't stream, so poll-transcribe the audio so far for a
        // live preview (admin-toggleable). Only for the cloud engine — offline
        // engines must not hit the network.
        const stream = engineRef.current.getStream()
        if (stream) livePreviewRef.current = startLivePreview(stream, setLiveTranscript)
      }

      const limit = ROUND_LIMITS[roundIndex]
      setTimeLeft(limit)
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) { stopRound() ; return 0 }
          return t - 1
        })
      }, 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone not available."
      recordClientSpeechReliabilityEvent({
        eventType: "recording",
        provider: engineRef.current?.name ?? "monologue-engine",
        route: "monologue-recording-start",
        practiceStage: "monologue",
        success: false,
        errorCode: msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied") ? "permission-denied" : "recording-start-failed",
        metadata: { engine: engineRef.current?.name ?? "Monologue engine" },
      })
      setMicError(msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")
        ? "Microphone blocked. Allow the mic in your browser address bar and try again."
        : msg)
      setRecording(false); setPhase("ready")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex])

  const stopRound = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (interimUnsubRef.current) { interimUnsubRef.current(); interimUnsubRef.current = null }
    livePreviewRef.current?.stop(); livePreviewRef.current = null
    setRecording(false); setSubmitting(true)
    try {
      if (!engineRef.current) return
      const sttStartedAt = Date.now()
      const result = await engineRef.current.stop()
      setMicStream(null)
      const transcript = result.transcript ?? ""
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? "monologue-engine",
        route: "monologue-engine-stop",
        practiceStage: "monologue",
        success: !!transcript.trim(),
        latencyMs: Date.now() - sttStartedAt,
        noSpeech: !transcript.trim() || result.errorCode === "no-speech",
        errorCode: transcript.trim() ? null : (result.errorCode ?? "no-speech"),
        metadata: { engine: engineRef.current?.name ?? "Monologue engine" },
      })
      const actualSeconds = (Date.now() - startRef.current) / 1000
      const rawMetrics = computeFluencyMetrics({
        transcript,
        audioDurationSeconds: actualSeconds,
        pauseEvents: pauseEventsRef.current,
        cefrBand: cefr,
      })

      // Sustained-speech guard: a couple of words ("yo yo") is NOT a fluent
      // monologue, even though words-per-minute math is high over a 1s burst.
      const speechSeconds = Math.max(0, rawMetrics.audioDurationSeconds - rawMetrics.totalPauseSeconds)
      const sufficiency = monologueSufficiency(rawMetrics.wordCount, speechSeconds)

      // Content/semantic guard: catch SUSTAINED nonsense the rate metric is blind
      // to ("yo yo yo…" said fast). Offline lexical check first; if it passes the
      // cheap gates, confirm coherence/on-topic with the AI grader (best-effort —
      // falls back to the offline score when AI isn't configured/reachable).
      const offlineContent = scoreContentQuality(transcript)
      let content = offlineContent
      if (sufficiency >= 0.5 && offlineContent >= 0.5) {
        try {
          const res = await fetch("/api/practice/content-grade", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript, topic: topic?.prompt ?? topic?.title ?? "" }),
          })
          const g = await res.json()
          if (typeof g?.coherence === "number") content = Math.min(content, g.coherence)
        } catch { /* AI optional — keep offline content score */ }
      }

      const adjusted = Math.max(0, Math.min(1, rawMetrics.fluencyIndex * sufficiency * content))
      const metrics: FluencyMetrics = { ...rawMetrics, fluencyIndex: Math.round(adjusted * 1000) / 1000 }

      const rr: RoundResult = {
        round: roundIndex + 1,
        limitSeconds: ROUND_LIMITS[roundIndex],
        actualSeconds: Math.round(actualSeconds),
        transcript,
        metrics,
        tooShort: sufficiency < 0.5,
        lowContent: sufficiency >= 0.5 && content < 0.5,
      }
      setResults((prev) => [...prev, rr])
      setPhase("round-summary")
    } catch (e) {
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? "monologue-engine",
        route: "monologue-engine-stop",
        practiceStage: "monologue",
        success: false,
        errorCode: "engine-stop-failed",
        metadata: { message: e instanceof Error ? e.message.slice(0, 120) : "Unknown stop error" },
      })
      setMicError("Something went wrong while scoring. Try the round again.")
      setPhase("ready")
    } finally {
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex, cefr, topic])

  const nextRound = () => {
    if (roundIndex < ROUND_LIMITS.length - 1) {
      setRoundIndex((i) => i + 1)
      setPhase("ready")
    } else {
      setPhase("final")
    }
  }

  // Save final result
  useEffect(() => {
    if (phase === "final" && !saved && results.length === ROUND_LIMITS.length && topic) {
      const improvement = scoreMonologueImprovement(results.map(r => ({
        speechRateWpm: r.metrics.speechRateWpm,
        articulationRateWpm: r.metrics.articulationRateWpm,
        fluencyIndex: r.metrics.fluencyIndex,
      })))
      fetch("/api/practice/fluency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drillType: "monologue", topicId: topic.id, cycleId,
          improvementScore: improvement,
          rounds: results.map(r => ({
            round: r.round, limitSeconds: r.limitSeconds, actualSeconds: r.actualSeconds,
            transcript: r.transcript, wordCount: r.metrics.wordCount,
            speechRateWpm: r.metrics.speechRateWpm, articulationRateWpm: r.metrics.articulationRateWpm,
            fluencyIndex: r.metrics.fluencyIndex,
          })),
        }),
      }).then(() => setSaved(true)).catch(() => {})
    }
  }, [phase, saved, results, topic, cycleId])

  const restart = () => {
    setPhase("topic"); setTopic(null); setRoundIndex(0); setResults([]); setSaved(false); setLiveTranscript("")
  }

  /* ── Renders ─────────────────────────────────────────────────────── */

  const topicList = topicsForBand(cefr)

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/practice/fluency" className="text-muted-foreground hover:text-foreground"><ArrowLeft size={20} /></Link>
        <Timer className="text-primary" size={22} />
        <h1 className="text-xl font-bold text-foreground">4/3/2 Timed Monologue</h1>
      </div>

      {micError && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{micError}</div>
      )}

      {/* TOPIC SELECT */}
      {phase === "topic" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick a topic. You&apos;ll speak about it <strong>three times</strong> — 90s, then 60s, then 40s.
            Saying the same thing in less time trains you to speak faster and more smoothly.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {topicList.map((t) => (
              <button key={t.id} onClick={() => pickTopic(t)}
                className="rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary hover:shadow-md">
                <div className="font-medium text-foreground">{t.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.prompt}</div>
              </button>
            ))}
          </div>
          <button onClick={pickRandom} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
            <Shuffle size={14} /> Surprise me
          </button>
        </div>
      )}

      {/* READY for round */}
      {phase === "ready" && topic && (
        <div className="space-y-5 text-center">
          <RoundPills roundIndex={roundIndex} />
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Round {roundIndex + 1} · {ROUND_LIMITS[roundIndex]} seconds</p>
            <h2 className="mt-2 text-2xl font-bold text-foreground">{topic.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground italic">{topic.prompt}</p>
            {roundIndex > 0 && (
              <p className="mt-3 text-xs text-emerald-400">Same topic — now say it in less time. Speak a little faster!</p>
            )}
          </div>
          <button onClick={startRound}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/25">
            <Mic size={18} /> Start Round {roundIndex + 1}
          </button>
        </div>
      )}

      {/* RECORDING */}
      {phase === "recording" && topic && (
        <div className="space-y-5 text-center">
          <RoundPills roundIndex={roundIndex} />
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold text-foreground">{topic.title}</h2>
            <div className={`mt-3 text-5xl font-bold tabular-nums ${timeLeft <= 10 ? "text-red-400" : "text-primary"}`}>
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <AudioVisualizer stream={micStream} isRecording={recording} />
            {liveTranscript ? (
              <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                {liveTranscript}<span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Keep speaking about the topic until the timer ends…</p>
                <p className="text-[0.65rem] text-muted-foreground/70">Your words appear here as you speak (and in full in the round summary).</p>
              </div>
            )}
          </div>
          <button onClick={stopRound} disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-semibold text-white shadow-lg shadow-red-500/25 disabled:opacity-50">
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <MicOff size={18} />} Stop early
          </button>
        </div>
      )}

      {/* ROUND SUMMARY */}
      {phase === "round-summary" && results[roundIndex] && (
        <div className="space-y-5 text-center">
          <RoundPills roundIndex={roundIndex} />
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Round {roundIndex + 1} complete</p>
            <RoundStats r={results[roundIndex]} prev={roundIndex > 0 ? results[roundIndex - 1] : undefined} />
            {results[roundIndex].tooShort && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-500">
                That was very short to measure fluency. Speak about the topic continuously for the full time to get an accurate score.
              </div>
            )}
            {!results[roundIndex].tooShort && results[roundIndex].lowContent && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-500">
                That didn&apos;t sound like a real monologue on the topic. Repeating a word or going off-topic doesn&apos;t count as fluent — speak in full, varied sentences about the topic.
              </div>
            )}
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-left">
              <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted-foreground">What we heard</p>
              <p className="text-sm text-foreground">
                {results[roundIndex].transcript?.trim()
                  ? results[roundIndex].transcript
                  : <span className="italic text-muted-foreground">No speech detected.</span>}
              </p>
            </div>
          </div>
          <button onClick={nextRound}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
            {roundIndex < ROUND_LIMITS.length - 1 ? <>Next round <ArrowRight size={16} /></> : <>See results <Trophy size={16} /></>}
          </button>
        </div>
      )}

      {/* FINAL */}
      {phase === "final" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <Trophy className="mx-auto mb-2 text-emerald-400" size={28} />
            <h2 className="text-lg font-bold text-foreground">Drill complete!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {results[2] && results[0] && results[2].metrics.speechRateWpm > results[0].metrics.speechRateWpm
                ? `Your speech rate rose from ${results[0].metrics.speechRateWpm} to ${results[2].metrics.speechRateWpm} wpm — that's fluency in action!`
                : "Keep practicing — speaking the same content repeatedly trains automaticity."}
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">Round</th>
                  <th className="px-3 py-2 text-right">Speech rate</th>
                  <th className="px-3 py-2 text-right">Articulation</th>
                  <th className="px-3 py-2 text-right">Words</th>
                  <th className="px-3 py-2 text-right">Fluency</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{r.limitSeconds}s</td>
                    <td className="px-3 py-2 text-right font-medium text-foreground">
                      {r.metrics.speechRateWpm} <Trend cur={r.metrics.speechRateWpm} prev={results[i - 1]?.metrics.speechRateWpm} />
                    </td>
                    <td className="px-3 py-2 text-right text-foreground">{r.metrics.articulationRateWpm}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{r.metrics.wordCount}</td>
                    <td className="px-3 py-2 text-right text-foreground">{Math.round(r.metrics.fluencyIndex * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-center gap-3">
            <button onClick={restart} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
              <RotateCcw size={14} /> New topic
            </button>
            <button onClick={() => router.push("/practice/fluency")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RoundPills({ roundIndex }: { roundIndex: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {ROUND_LIMITS.map((lim, i) => (
        <div key={i} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
          i < roundIndex ? "bg-emerald-500/20 text-emerald-400"
          : i === roundIndex ? "bg-primary/20 text-primary ring-1 ring-primary/40"
          : "bg-muted text-muted-foreground"
        }`}>
          <Timer size={11} /> {lim}s
        </div>
      ))}
    </div>
  )
}

function RoundStats({ r, prev }: { r: RoundResult; prev?: RoundResult }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      <Stat label="Speech rate" value={`${r.metrics.speechRateWpm}`} unit="wpm" cur={r.metrics.speechRateWpm} prev={prev?.metrics.speechRateWpm} />
      <Stat label="Words said" value={`${r.metrics.wordCount}`} unit="" />
      <Stat label="Fluency" value={`${Math.round(r.metrics.fluencyIndex * 100)}`} unit="%" cur={r.metrics.fluencyIndex} prev={prev?.metrics.fluencyIndex} />
    </div>
  )
}

function Stat({ label, value, unit, cur, prev }: { label: string; value: string; unit: string; cur?: number; prev?: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
      <div className="text-xl font-bold text-foreground">
        {value}<span className="text-[0.6rem] font-normal text-muted-foreground">{unit}</span>
        {cur !== undefined && prev !== undefined && <span className="ml-1"><Trend cur={cur} prev={prev} /></span>}
      </div>
      <div className="mt-0.5 text-[0.65rem] text-muted-foreground">{label}</div>
    </div>
  )
}

function Trend({ cur, prev }: { cur: number; prev?: number }) {
  if (prev === undefined) return null
  if (cur > prev) return <TrendingUp size={13} className="inline text-emerald-400" />
  if (cur < prev) return <TrendingDown size={13} className="inline text-red-400" />
  return <Minus size={13} className="inline text-muted-foreground" />
}

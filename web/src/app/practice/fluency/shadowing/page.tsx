"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, AudioLines, Volume2, Mic, MicOff, Loader2, ArrowRight, RotateCcw, Trophy } from "lucide-react"
import { getSpeechEngine, getDefaultEngine } from "@/lib/speech/speech-factory"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { speak } from "@/lib/speech/tts"
import { compareTextToTranscript } from "@/lib/scoring/text-comparison"
import { scoreTimingMatch } from "@/lib/scoring"
import { assessPronunciation, isPronunciationConfigured, NO_SPEECH } from "@/lib/speech/pronunciation-assess"
import type { WordScore } from "@/lib/scoring/azure-pronunciation"
import { AudioVisualizer } from "@/components/shared/audio-visualizer"
import { WordDiff } from "@/components/shared/word-diff"
import { PronunciationBreakdown } from "@/components/shared/pronunciation-breakdown"
import { shadowingSetForBand, type CefrBand } from "@/lib/fluency/shadowing-sentences"
import { recordClientSpeechReliabilityEvent } from "@/lib/speech/reliability-client"

interface ItemResult {
  sentence: string
  transcript: string
  refDurationSec: number
  studentDurationSec: number
  accuracy: number
  timingMatch: number
  composite: number
  weakWords: string[]
  azureWords?: WordScore[]
  byAzure?: boolean
}

type Phase = "intro" | "listen" | "ready" | "recording" | "item-summary" | "final"

export default function ShadowingPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("intro")
  const [cefr, setCefr] = useState<CefrBand>("A1")
  const [sentences, setSentences] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState<ItemResult[]>([])
  const [recording, setRecording] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cycleId, setCycleId] = useState<number | null>(null)

  const engineRef = useRef<SpeechEngine | null>(null)
  const interimUnsubRef = useRef<(() => void) | null>(null)
  const refDurationRef = useRef(0)
  const recStartRef = useRef(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()
    fetch("/api/practice").then(r => r.json()).then(d => {
      const band = (d?.book?.cefrLevel as CefrBand) ?? "A1"
      setCefr(band)
      const set = shadowingSetForBand(band)
      // Mix curated set with vocab example sentences for variety
      const extras: string[] = (d?.vocabulary ?? [])
        .map((v: { exampleSentence: string | null }) => v.exampleSentence)
        .filter((s: string | null): s is string => !!s && s.split(/\s+/).length >= 4)
        .slice(0, 3)
      setSentences([...set.sentences, ...extras])
      if (d?.cycle?.id) setCycleId(d.cycle.id)
    }).catch(() => {
      setSentences(shadowingSetForBand("A1").sentences)
    })
    return () => {
      if (interimUnsubRef.current) interimUnsubRef.current()
      engineRef.current?.stop?.().catch(() => {})
    }
  }, [])

  const sentence = sentences[idx] ?? ""

  const playReference = useCallback(async () => {
    if (!sentence) return
    setSpeaking(true)
    const t0 = Date.now()
    try {
      await speak(sentence)
      refDurationRef.current = (Date.now() - t0) / 1000
    } finally {
      setSpeaking(false)
      setPhase("ready")
    }
  }, [sentence])

  const startRecord = useCallback(async () => {
    setMicError(null); setLiveTranscript("")
    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
      const stream = engineRef.current.getStream()
      setMicStream(stream)
      setRecording(true); setPhase("recording")
      recStartRef.current = Date.now()
      if (engineRef.current.onInterim) {
        interimUnsubRef.current = engineRef.current.onInterim((t) => setLiveTranscript(t))
      }
      // Parallel recorder to capture audio for Azure pronunciation assessment.
      if (stream && typeof MediaRecorder !== "undefined") {
        try {
          recordedChunksRef.current = []
          const mr = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined)
          mr.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
          mr.start(200)
          mediaRecorderRef.current = mr
        } catch { /* playback/Azure optional */ }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone not available."
      recordClientSpeechReliabilityEvent({
        eventType: "recording",
        provider: engineRef.current?.name ?? "shadowing-engine",
        route: "shadowing-recording-start",
        practiceStage: "shadowing",
        success: false,
        errorCode: msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied") ? "permission-denied" : "recording-start-failed",
        metadata: { engine: engineRef.current?.name ?? "Shadowing engine" },
      })
      setMicError(msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")
        ? "Microphone blocked. Allow the mic in your browser address bar and try again."
        : msg)
      setRecording(false); setPhase("ready")
    }
  }, [])

  const stopRecord = useCallback(async () => {
    if (interimUnsubRef.current) { interimUnsubRef.current(); interimUnsubRef.current = null }
    setRecording(false); setSubmitting(true)

    // Stop the parallel recorder and build the audio blob (for Azure).
    let recordingBlobPromise: Promise<Blob | null> = Promise.resolve(null)
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== "inactive") {
      recordingBlobPromise = new Promise<Blob | null>((resolve) => {
        mr.onstop = () => {
          if (recordedChunksRef.current.length === 0) { resolve(null); return }
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || "audio/webm" })
          recordedChunksRef.current = []
          resolve(blob)
        }
        try { mr.stop() } catch { resolve(null) }
      })
      mediaRecorderRef.current = null
    }

    try {
      if (!engineRef.current) return
      const sttStartedAt = Date.now()
      const result = await engineRef.current.stop()
      setMicStream(null)
      const studentDur = (Date.now() - recStartRef.current) / 1000
      const transcript = result.transcript ?? ""
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? "shadowing-engine",
        route: "shadowing-engine-stop",
        practiceStage: "shadowing",
        success: !!transcript.trim(),
        latencyMs: Date.now() - sttStartedAt,
        noSpeech: !transcript.trim() || result.errorCode === "no-speech",
        errorCode: transcript.trim() ? null : (result.errorCode ?? "no-speech"),
        metadata: { engine: engineRef.current?.name ?? "Shadowing engine" },
      })
      const cmp = compareTextToTranscript(sentence, transcript)
      const timing = scoreTimingMatch(refDurationRef.current, studentDur)

      // Default: text-accuracy × rhythm. With Azure, use real pronunciation
      // accuracy (the point of shadowing) and show the sound-by-sound breakdown.
      let accuracy = cmp.accuracyScore
      let azureWords: WordScore[] | undefined
      let byAzure = false
      const recordingBlob = await recordingBlobPromise
      if (recordingBlob && transcript && (await isPronunciationConfigured())) {
        const azure = await assessPronunciation(recordingBlob, sentence, cefr, 0).catch(() => null)
        if (azure === NO_SPEECH) { accuracy = 0; byAzure = true } // heard no clear speech → miss
        else if (azure) { accuracy = azure.breakdown.pronunciation; azureWords = azure.words; byAzure = true }
      }

      const composite = accuracy * 0.7 + timing * 0.3
      const ir: ItemResult = {
        sentence, transcript,
        refDurationSec: Math.round(refDurationRef.current * 10) / 10,
        studentDurationSec: Math.round(studentDur * 10) / 10,
        accuracy,
        timingMatch: timing,
        composite,
        weakWords: cmp.weakWords,
        azureWords,
        byAzure,
      }
      setResults((prev) => [...prev, ir])
      setPhase("item-summary")
    } catch (e) {
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? "shadowing-engine",
        route: "shadowing-engine-stop",
        practiceStage: "shadowing",
        success: false,
        errorCode: "engine-stop-failed",
        metadata: { message: e instanceof Error ? e.message.slice(0, 120) : "Unknown stop error" },
      })
      setMicError("Something went wrong. Try the sentence again.")
      setPhase("ready")
    } finally {
      setSubmitting(false)
    }
  }, [sentence])

  const next = () => {
    if (idx < sentences.length - 1) { setIdx(i => i + 1); setPhase("listen"); setLiveTranscript("") }
    else setPhase("final")
  }

  // Save on final
  const savedRef = useRef(false)
  useEffect(() => {
    if (phase === "final" && !savedRef.current && results.length > 0) {
      savedRef.current = true
      const avg = results.reduce((s, r) => s + r.composite, 0) / results.length
      fetch("/api/practice/fluency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drillType: "shadowing", cycleId, improvementScore: avg,
          rounds: results.map(r => ({
            sentence: r.sentence, transcript: r.transcript,
            refDurationSec: r.refDurationSec, studentDurationSec: r.studentDurationSec,
            accuracy: r.accuracy, timingMatch: r.timingMatch, weakWords: r.weakWords,
            actualSeconds: r.studentDurationSec, wordCount: r.sentence.split(/\s+/).length,
            speechRateWpm: 0, articulationRateWpm: 0, fluencyIndex: r.composite,
          })),
        }),
      }).catch(() => {})
    }
  }, [phase, results, cycleId])

  const restart = () => { setPhase("intro"); setIdx(0); setResults([]); savedRef.current = false; setLiveTranscript("") }
  const pct = (v: number) => Math.round(v * 100)
  const color = (v: number) => v >= 0.8 ? "text-emerald-400" : v >= 0.5 ? "text-amber-400" : "text-red-400"

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/practice/fluency" className="text-muted-foreground hover:text-foreground"><ArrowLeft size={20} /></Link>
        <AudioLines className="text-primary" size={22} />
        <h1 className="text-xl font-bold text-foreground">Shadowing</h1>
      </div>

      {micError && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{micError}</div>
      )}

      {phase === "intro" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;ll hear {sentences.length} model sentences. For each one: <strong>listen</strong>, then
            <strong> repeat it</strong> trying to match the rhythm and pace. Shadowing trains natural intonation and
            connected speech — the music of the language.
          </p>
          <button onClick={() => setPhase("listen")} disabled={sentences.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Start ({cefr} level)
          </button>
        </div>
      )}

      {(phase === "listen" || phase === "ready" || phase === "recording") && (
        <div className="space-y-5 text-center">
          <p className="text-xs text-muted-foreground">Sentence {idx + 1} of {sentences.length}</p>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xl font-medium text-foreground leading-relaxed">&ldquo;{sentence}&rdquo;</p>
          </div>

          {phase === "listen" && (
            <button onClick={playReference} disabled={speaking}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {speaking ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />} {speaking ? "Playing…" : "Listen to the model"}
            </button>
          )}

          {phase === "ready" && (
            <div className="flex flex-col items-center gap-2">
              <button onClick={startRecord}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/25">
                <Mic size={18} /> Repeat it
              </button>
              <button onClick={playReference} className="text-xs text-muted-foreground hover:text-foreground">Hear it again</button>
            </div>
          )}

          {phase === "recording" && (
            <div className="flex flex-col items-center gap-3">
              <AudioVisualizer stream={micStream} isRecording={recording} />
              {liveTranscript && (
                <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                  {liveTranscript}<span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
                </div>
              )}
              <button onClick={stopRecord} disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-semibold text-white shadow-lg shadow-red-500/25 disabled:opacity-50">
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <MicOff size={18} />} Stop
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "item-summary" && results[idx] && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <div className={`text-2xl font-bold ${color(results[idx].accuracy)}`}>{pct(results[idx].accuracy)}%</div>
                <div className="text-[0.65rem] text-muted-foreground">{results[idx].byAzure ? "Pronunciation" : "Accuracy"}</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${color(results[idx].timingMatch)}`}>{pct(results[idx].timingMatch)}%</div>
                <div className="text-[0.65rem] text-muted-foreground">Rhythm match</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${color(results[idx].composite)}`}>{pct(results[idx].composite)}%</div>
                <div className="text-[0.65rem] text-muted-foreground">Overall</div>
              </div>
            </div>
            <WordDiff expected={results[idx].sentence} transcript={results[idx].transcript} />
            <p className="mt-3 text-xs text-muted-foreground text-center">
              Model: {results[idx].refDurationSec}s · You: {results[idx].studentDurationSec}s
            </p>
          </div>
          {results[idx].azureWords && results[idx].azureWords!.length > 0
            ? <PronunciationBreakdown words={results[idx].azureWords!} />
            : <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-2"><Mic size={14} className="text-primary" /><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sound detail</h3></div><p className="mt-2 text-sm text-muted-foreground">Only basic transcript and rhythm scoring was available for this attempt, so phoneme-level detail is not shown.</p></div>}
          <div className="flex justify-center">
            <button onClick={next}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
              {idx < sentences.length - 1 ? <>Next sentence <ArrowRight size={16} /></> : <>See results <Trophy size={16} /></>}
            </button>
          </div>
        </div>
      )}

      {phase === "final" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <Trophy className="mx-auto mb-2 text-emerald-400" size={28} />
            <h2 className="text-lg font-bold text-foreground">Shadowing complete!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Average score: {pct(results.reduce((s, r) => s + r.composite, 0) / Math.max(1, results.length))}%
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button onClick={restart} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
              <RotateCcw size={14} /> Again
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

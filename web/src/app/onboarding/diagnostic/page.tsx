"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Mic, MicOff, Volume2, Loader2, ArrowRight, Sparkles, Gauge, CheckCircle2, Target, ListChecks } from "lucide-react"
import { getSpeechEngine, getDefaultEngine } from "@/lib/speech/speech-factory"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { speak } from "@/lib/speech/tts"
import { calculateScore, computeFluencyMetrics, monologueSufficiency, scoreContentQuality, type FluencyMetrics } from "@/lib/scoring"
import { assessPronunciation, isPronunciationConfigured, NO_SPEECH } from "@/lib/speech/pronunciation-assess"
import { AudioVisualizer } from "@/components/shared/audio-visualizer"

const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

type DiagnosticTaskType = "repeat" | "read" | "speak" | "recall"
type Phase = "intro" | "task" | "recording" | "scoring" | "result"

interface DiagnosticTask {
  type: DiagnosticTaskType
  text: string
  instruction: string
  displayText?: string
  subtext?: string
}

interface DiagnosticSample {
  kind: DiagnosticTaskType | "free-speak"
  target?: string
  transcript: string
  fluencyIndex: number
  speechRateWpm: number
  contentScore?: number
  targetScore?: number
  pron?: number
  byAzure?: boolean
}

interface DiagnosticResult {
  suggestedCefr: string
  fluencyIndex: number
  speechRateWpm: number
  pronAvg?: number | null
  contentScore?: number
  skillBands?: {
    pronunciation: string | null
    fluency: string
    sentenceProduction: string
    recallReadiness: string | null
  }
  strengths?: string[]
  weaknesses?: string[]
  recommendedStartingStage?: string
  recommendedPracticePath?: Array<{ title: string; href: string; reason: string }>
}

const BASE_TASKS: DiagnosticTask[] = [
  {
    type: "repeat",
    text: "hello",
    instruction: "Microphone check: listen, then repeat this word.",
    subtext: "This confirms the app can hear and transcribe you before scoring starts.",
  },
  {
    type: "read",
    text: "I usually wake up early and have breakfast before work.",
    instruction: "Read this sentence aloud.",
    subtext: "This checks pronunciation, decoding, and sentence rhythm.",
  },
  {
    type: "repeat",
    text: "Can you help me?",
    instruction: "Listen, then repeat this short sentence.",
    subtext: "This checks sound imitation and short sentence control.",
  },
  {
    type: "speak",
    text: "Tell me about your day. What did you do today? Speak for about 20 seconds.",
    instruction: "Speak freely for about 20 seconds.",
    subtext: "This checks spontaneous fluency and content.",
  },
]

function stageLabel(stage?: string) {
  switch (stage) {
    case "repeat":
      return "Repeat and Read Aloud"
    case "sentence":
      return "Sentence Practice"
    case "review":
      return "Review and Weak Words"
    case "free-speak":
      return "Free Speak"
    default:
      return "Practice Hub"
  }
}

function metricPct(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "Not measured"
}

export default function DiagnosticPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("intro")
  const [taskIdx, setTaskIdx] = useState(0)
  const [tasks, setTasks] = useState<DiagnosticTask[]>(BASE_TASKS)
  const [samples, setSamples] = useState<DiagnosticSample[]>([])
  const [recording, setRecording] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [azureConfigured, setAzureConfigured] = useState(false)

  const engineRef = useRef<SpeechEngine | null>(null)
  const interimUnsubRef = useRef<(() => void) | null>(null)
  const pauseEventsRef = useRef<{ at: number; durationMs: number }[]>([])
  const lastInterimRef = useRef(0)
  const startRef = useRef(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    engineRef.current = saved ? getSpeechEngine(saved) : getDefaultEngine()
    isPronunciationConfigured().then(setAzureConfigured).catch(() => setAzureConfigured(false))

    fetch("/api/practice")
      .then((r) => r.json())
      .then((data) => {
        const recallWord = data?.vocabulary?.find?.((v: { word?: string; arabicMeaning?: string | null }) => v?.word && v?.arabicMeaning)
        if (!recallWord) return
        setTasks([
          ...BASE_TASKS,
          {
            type: "recall",
            text: recallWord.word,
            displayText: recallWord.arabicMeaning,
            instruction: "Vocabulary recall: say the English word for this meaning.",
            subtext: "This checks whether your active cycle vocabulary is ready for speaking practice.",
          },
        ])
      })
      .catch(() => {})

    const warmId = setTimeout(() => { engineRef.current?.prepare?.().catch(() => {}) }, 1500)
    return () => {
      clearTimeout(warmId)
      if (interimUnsubRef.current) interimUnsubRef.current()
      engineRef.current?.stop?.().catch(() => {})
      try { mediaRecorderRef.current?.stop() } catch { /* ignore */ }
    }
  }, [])

  const task = tasks[taskIdx] ?? BASE_TASKS[0]

  const playTask = async () => {
    setSpeaking(true)
    await speak(task.text)
    setSpeaking(false)
  }

  const skipForSession = () => {
    sessionStorage.setItem(DIAGNOSTIC_SKIP_KEY, "1")
    router.push("/practice/hub")
  }

  const startRecord = useCallback(async () => {
    setMicError(null)
    setLiveTranscript("")
    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
      const stream = engineRef.current.getStream()
      setMicStream(stream)
      setRecording(true)
      setPhase("recording")
      pauseEventsRef.current = []
      startRef.current = Date.now()
      lastInterimRef.current = Date.now()

      if (stream && typeof MediaRecorder !== "undefined") {
        try {
          recordedChunksRef.current = []
          const mr = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined)
          mr.ondataavailable = (event) => { if (event.data.size > 0) recordedChunksRef.current.push(event.data) }
          mr.start(200)
          mediaRecorderRef.current = mr
        } catch { /* Azure optional */ }
      }

      if (engineRef.current.onInterim) {
        interimUnsubRef.current = engineRef.current.onInterim((text) => {
          const now = Date.now()
          const gap = now - lastInterimRef.current
          if (gap >= 500 && lastInterimRef.current > startRef.current) {
            pauseEventsRef.current.push({ at: now - startRef.current, durationMs: gap })
          }
          lastInterimRef.current = now
          setLiveTranscript(text)
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Microphone not available."
      setMicError(msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")
        ? "Microphone blocked. Allow the mic in your browser address bar, then try again."
        : msg)
      setRecording(false)
      setPhase("task")
    }
  }, [])

  const stopRecord = useCallback(async () => {
    if (interimUnsubRef.current) {
      interimUnsubRef.current()
      interimUnsubRef.current = null
    }
    setRecording(false)
    setPhase("scoring")

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
      const response = await engineRef.current.stop()
      setMicStream(null)
      const cleanTranscript = (response.transcript ?? "").trim()
      const currentTask = tasks[taskIdx]

      if (cleanTranscript.length === 0) {
        const engineName = engineRef.current?.name ?? "Speech engine"
        setMicError(`[${engineName}] ${response.errorMessage ?? "We didn't hear anything. Check your microphone and try this step again."}`)
        setPhase("task")
        return
      }

      let pron: number | undefined
      let byAzure = false
      if ((currentTask.type === "read" || currentTask.type === "repeat") && azureConfigured) {
        const blob = await recordingBlobPromise
        if (blob) {
          const azure = await assessPronunciation(blob, currentTask.text, "B1", 0).catch(() => null)
          if (azure === NO_SPEECH) {
            setMicError("We couldn't make out clear speech for that task. Please try again, a little louder.")
            setPhase("task")
            return
          }
          if (azure) {
            const raw = azure.raw
            pron = Math.max(0, Math.min(1, (raw.accuracy * 0.5 + raw.prosody * 0.3 + raw.fluency * 0.2) / 100))
            byAzure = true
          }
        }
      }

      const dur = (Date.now() - startRef.current) / 1000
      const metrics: FluencyMetrics = computeFluencyMetrics({
        transcript: cleanTranscript,
        audioDurationSeconds: dur,
        pauseEvents: pauseEventsRef.current,
        cefrBand: "B1",
      })

      let fluencyIndex = metrics.fluencyIndex
      let contentScore: number | undefined
      let targetScore: number | undefined

      if (currentTask.type === "speak") {
        const speechSeconds = Math.max(0, metrics.audioDurationSeconds - metrics.totalPauseSeconds)
        const sufficiency = monologueSufficiency(metrics.wordCount, speechSeconds)
        let content = scoreContentQuality(cleanTranscript)
        if (sufficiency >= 0.5 && content >= 0.5) {
          try {
            const res = await fetch("/api/practice/content-grade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: cleanTranscript,
                topic: currentTask.text,
                fluencyMetrics: metrics,
              }),
            })
            const grade = await res.json()
            if (typeof grade?.coherence === "number") content = Math.min(content, grade.coherence)
          } catch { /* AI optional */ }
        }
        contentScore = content
        fluencyIndex = Math.max(0, Math.min(1, metrics.fluencyIndex * sufficiency * content))
      }

      if (currentTask.type === "repeat" || currentTask.type === "recall") {
        const target = calculateScore({
          transcript: cleanTranscript,
          expectedAnswersJson: JSON.stringify([currentTask.text]),
          spokenPhonemes: null,
          referencePhonemes: null,
          audioDurationSeconds: dur,
          bestPreviousScore: 0,
          latestPreviousScore: 0,
          previousAttemptCount: 0,
          cefrBand: "A1",
          fluencyMetrics: metrics,
        })
        targetScore = target.targetMatch
        if (currentTask.type === "recall") {
          fluencyIndex = Math.min(fluencyIndex, Math.max(0.15, target.composite))
        }
      }

      const sample: DiagnosticSample = {
        kind: currentTask.type === "speak" ? "free-speak" : currentTask.type,
        target: currentTask.type === "speak" ? undefined : currentTask.text,
        transcript: cleanTranscript,
        fluencyIndex,
        speechRateWpm: metrics.speechRateWpm,
        ...(contentScore !== undefined ? { contentScore } : {}),
        ...(targetScore !== undefined ? { targetScore } : {}),
        ...(pron !== undefined ? { pron, byAzure } : {}),
      }
      const nextSamples = [...samples, sample]
      setSamples(nextSamples)

      if (taskIdx < tasks.length - 1) {
        setTaskIdx((index) => index + 1)
        setPhase("task")
      } else {
        const res = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save-diagnostic", samples: nextSamples, applyCefr: true }),
        })
        const data = await res.json()
        if (res.ok && data.result) setResult(data.result)
        setPhase("result")
      }
    } catch {
      setMicError("Something went wrong. Try that step again.")
      setPhase("task")
    }
  }, [samples, taskIdx, tasks, azureConfigured])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl">
        {phase === "intro" && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/15">
              <Gauge className="text-primary" size={28} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Required speaking check</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Before normal practice, complete a short balanced check. It verifies your microphone, estimates your starting level, and creates a practice path for pronunciation, fluency, sentence production, and recall.
            </p>
            <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
              {["Mic and STT readiness", "Read-aloud pronunciation", "Short repeat control", "Free speaking content", tasks.length > BASE_TASKS.length ? "Vocabulary recall" : "Vocabulary recall when available"].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 text-sm text-foreground">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
            <button
              onClick={() => setPhase("task")}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90"
            >
              Start check <ArrowRight size={16} />
            </button>
            <button onClick={skipForSession} className="mt-3 block w-full text-xs text-muted-foreground hover:text-foreground">
              Skip for this session
            </button>
          </div>
        )}

        {micError && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{micError}</div>
        )}

        {(phase === "task" || phase === "recording" || phase === "scoring") && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
            <div className="mb-4 flex items-center justify-center gap-1.5">
              {tasks.map((_, index) => (
                <div key={index} className={`h-1.5 w-10 rounded-full ${index < taskIdx ? "bg-emerald-500" : index === taskIdx ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Step {taskIdx + 1} of {tasks.length}</p>
            <p className="mt-2 text-sm font-medium text-foreground">{task.instruction}</p>
            {task.subtext && <p className="mt-1 text-xs text-muted-foreground">{task.subtext}</p>}
            <div className="my-4 rounded-xl border border-border bg-muted/30 p-5">
              {task.type === "speak" ? (
                <p className="text-base italic text-muted-foreground">{task.text}</p>
              ) : (
                <>
                  {task.type === "recall" && <p className="mb-2 text-xs uppercase tracking-wide text-primary">Meaning</p>}
                  <p className="text-xl font-semibold text-foreground">{task.type === "recall" ? task.displayText : `"${task.text}"`}</p>
                </>
              )}
            </div>

            {phase === "task" && (
              <div className="flex flex-col items-center gap-2">
                {(task.type === "read" || task.type === "repeat") && (
                  <button
                    onClick={playTask}
                    disabled={speaking}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <Volume2 size={13} /> {speaking ? "Playing..." : "Hear it first"}
                  </button>
                )}
                <button
                  onClick={startRecord}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-90"
                >
                  <Mic size={18} /> {task.type === "speak" ? "Start speaking" : "Start recording"}
                </button>
              </div>
            )}

            {phase === "recording" && (
              <div className="flex flex-col items-center gap-3">
                <AudioVisualizer stream={micStream} isRecording={recording} />
                {liveTranscript && (
                  <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-2 text-sm text-foreground">{liveTranscript}</div>
                )}
                <button
                  onClick={stopRecord}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-semibold text-white shadow-lg shadow-red-500/25"
                >
                  <MicOff size={18} /> Done
                </button>
              </div>
            )}

            {phase === "scoring" && (
              <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 size={18} className="animate-spin" /> Analyzing...
              </div>
            )}
          </div>
        )}

        {phase === "result" && (
          <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-card p-8 shadow-xl">
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 text-emerald-400" size={36} />
              <h1 className="text-2xl font-bold text-foreground">Your starting level</h1>
              <div className="my-4 inline-flex items-center gap-2 rounded-full bg-primary/15 px-5 py-2">
                <Sparkles size={18} className="text-primary" />
                <span className="text-2xl font-bold text-primary">{result?.suggestedCefr ?? "A1"}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Fluency {metricPct(result?.fluencyIndex)} | Speech rate {result?.speechRateWpm ?? 0} wpm | Pronunciation {metricPct(result?.pronAvg)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Pronunciation</p>
                <p className="mt-1 text-lg font-bold text-foreground">{result?.skillBands?.pronunciation ?? "Pending"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Fluency</p>
                <p className="mt-1 text-lg font-bold text-foreground">{result?.skillBands?.fluency ?? "A1"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Sentence production</p>
                <p className="mt-1 text-lg font-bold text-foreground">{result?.skillBands?.sentenceProduction ?? "A1"}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 size={16} /> What you did well
                </div>
                <ul className="space-y-2 text-sm text-foreground">
                  {(result?.strengths ?? ["You completed the check."]).map((item) => <li key={item}>- {item}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <Target size={16} /> What to practice first
                </div>
                <p className="text-sm font-semibold text-foreground">{stageLabel(result?.recommendedStartingStage)}</p>
                <ul className="mt-2 space-y-2 text-sm text-foreground">
                  {(result?.weaknesses ?? ["Keep practicing all modes."]).map((item) => <li key={item}>- {item}</li>)}
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListChecks size={16} className="text-primary" /> Recommended path
              </div>
              <div className="space-y-2">
                {(result?.recommendedPracticePath ?? []).map((item, index) => (
                  <div key={item.href} className="flex items-start gap-3 rounded-lg bg-background/60 p-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{index + 1}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Link
                href={result?.recommendedPracticePath?.[0]?.href ?? "/practice/hub"}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Start recommended path <ArrowRight size={16} />
              </Link>
              <Link href="/practice/weak-words" className="rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted/50">
                Weak Words
              </Link>
              <Link href="/practice/fluency" className="rounded-lg border border-border px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted/50">
                Fluency Drills
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

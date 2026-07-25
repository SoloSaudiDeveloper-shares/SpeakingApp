"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Mic, MicOff, Volume2, ArrowRight, RotateCcw, Loader2, ArrowLeft, Settings2, AlertTriangle, BookOpen, Sparkles, Eye, MessageSquare, Ear } from "lucide-react"
import { useAuth } from "@/lib/hooks/use-auth"
import { speak, prepareActiveTts } from "@/lib/speech/tts"
import { getSpeechEngine, getDefaultEngine, markEngineFailed, DEFAULT_ENGINE_ID } from "@/lib/speech/speech-factory"
import { recordClientSpeechReliabilityEvent } from "@/lib/speech/reliability-client"
import { checkWebGPU } from "@/lib/speech/webgpu-check"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { STT_ENGINE_OPTIONS } from "@/lib/speech/types"
import {
  calculateScore,
  generateFeedback,
  computeFluencyMetrics,
  scoreFreeSpeak,
  pronunciationWeakWordsFromAzureWords,
  type ScoreBreakdown,
  type FullFeedback,
  type FluencyMetrics,
  type FreeSpeakAiGrade,
  type FreeSpeakMetadata,
  type PronunciationWeakWordEvidence,
} from "@/lib/scoring"
import { assessPronunciation, isPronunciationConfigured, NO_SPEECH } from "@/lib/speech/pronunciation-assess"
import type { WordScore } from "@/lib/scoring/azure-pronunciation"
import { PronunciationBreakdown } from "@/components/shared/pronunciation-breakdown"
import { ScoreDisplay } from "@/components/shared/score-display"
import { AudioVisualizer } from "@/components/shared/audio-visualizer"
import { FeedbackPanel } from "@/components/shared/feedback-panel"
import { FluencyMetricsCard } from "@/components/shared/fluency-metrics-card"
import { FREE_SPEAK_COMPOSITE_HELP, STANDARD_SCORE_HELP, buildFreeSpeakRows } from "@/lib/scoring/score-card-help"

const DIAGNOSTIC_SKIP_KEY = "speaking-lab-diagnostic-skip-session"

interface VocabItem {
  id: number; word: string; arabicMeaning: string | null
  exampleSentence: string | null; phonemeString: string | null
}
interface Task {
  id: number; vocabularyItemId: number | null; taskType: string
  prompt: string; expectedAnswers: string | null; passScore: number
}
interface PracticeData {
  cycle: { id: number } | null
  book: { id: number; cefrLevel: string } | null
  student?: { id: number; displayName: string | null; cefrBand?: string | null }
  vocabulary: VocabItem[]; tasks: Task[]
  attempts: Array<{ practiceTaskId: number; compositeScore: number }>
  mastery: Array<{ vocabularyItemId: number; bestScore: number; latestScore: number; timesSpoken: number }>
}

type StageKey = "listen" | "repeat" | "read-aloud" | "sentence" | "free-speak" | "review"

type StageMode = "listen" | "repeat" | "read" | "sentence" | "free" | "review"

interface StageMeta {
  key: StageKey
  title: string
  badge: string
  icon: React.ElementType
  /** Whether to show the Listen button (admin-cued audio first). */
  showListenButton: boolean
  /** Whether the student must record speech for this stage. */
  requiresRecording: boolean
  /** Hint text shown above the target word/sentence. */
  hint: string
  /** One-line task instruction shown in the stage banner. */
  instruction: string
  /** What skill this stage tests (shown as a sub-label). */
  skill: string
  /** Distinct render mode for the stage body. */
  mode: StageMode
  /** Auto-play the model audio when the stage loads (audio-first stages). */
  autoPlay: boolean
  /** Tailwind accent classes for the stage banner/border. */
  accent: string
  accentText: string
  /** Step label, e.g. "Step 2 of 6". */
  stepLabel: string
}

const STAGE_META: Record<StageKey, StageMeta> = {
  "listen": {
    key: "listen", title: "Listen", badge: "Listen", icon: Ear,
    showListenButton: true, requiresRecording: false,
    hint: "Listen to the word and tap Got it when you can recognise it",
    instruction: "Listen carefully to how the word sounds.",
    skill: "Recognition", mode: "listen", autoPlay: true,
    accent: "border-sky-500/40 bg-sky-500/10", accentText: "text-sky-400", stepLabel: "Hear it",
  },
  "repeat": {
    key: "repeat", title: "Listen & Repeat", badge: "Repeat", icon: Mic,
    showListenButton: true, requiresRecording: true,
    hint: "Listen to the model, then say the word exactly the same way",
    instruction: "Hear the model, then repeat it exactly.",
    skill: "Imitation", mode: "repeat", autoPlay: true,
    accent: "border-indigo-500/40 bg-indigo-500/10", accentText: "text-indigo-400", stepLabel: "Say it back",
  },
  "read-aloud": {
    key: "read-aloud", title: "Read Aloud", badge: "Read Aloud", icon: BookOpen,
    showListenButton: false, requiresRecording: true,
    hint: "Read the word out loud on your own — no audio help",
    instruction: "Read the word out loud on your own — no audio first.",
    skill: "Decoding", mode: "read", autoPlay: false,
    accent: "border-amber-500/40 bg-amber-500/10", accentText: "text-amber-400", stepLabel: "Read it",
  },
  "sentence": {
    key: "sentence", title: "Use in a Sentence", badge: "Sentence", icon: MessageSquare,
    showListenButton: true, requiresRecording: true,
    hint: "Read the whole sentence aloud, smoothly",
    instruction: "Read the full sentence aloud, keeping it smooth.",
    skill: "Fluency in context", mode: "sentence", autoPlay: false,
    accent: "border-violet-500/40 bg-violet-500/10", accentText: "text-violet-400", stepLabel: "Use it",
  },
  "free-speak": {
    key: "free-speak", title: "Free Speak", badge: "Free Speak", icon: Sparkles,
    showListenButton: false, requiresRecording: true,
    hint: "Make your own English sentence using the target word or phrase",
    instruction: "Create your own sentence with the displayed vocabulary item.",
    skill: "Production", mode: "free", autoPlay: false,
    accent: "border-emerald-500/40 bg-emerald-500/10", accentText: "text-emerald-400", stepLabel: "Create",
  },
  "review": {
    key: "review", title: "Review Test", badge: "Test", icon: Eye,
    showListenButton: false, requiresRecording: true,
    hint: "Look at the meaning and say the English word from memory",
    instruction: "Recall test — say the English word from its meaning.",
    skill: "Recall", mode: "review", autoPlay: false,
    accent: "border-rose-500/40 bg-rose-500/10", accentText: "text-rose-400", stepLabel: "Test",
  },
}

/** Highlight the target word inside a sentence (case-insensitive). */
function highlightWordInSentence(sentence: string, word: string): React.ReactNode {
  if (!word) return sentence
  const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi")
  const parts = sentence.split(re)
  return parts.map((p, i) =>
    i % 2 === 1 ? <span key={i} className="text-primary font-bold underline decoration-dotted">{p}</span> : p,
  )
}

/** Map a task's taskType (which may be legacy like "ListenRepeat") to a canonical stage. */
function resolveStage(taskType: string | undefined, urlStage: string | null): StageKey {
  // URL param wins (e.g. /practice?stage=sentence)
  if (urlStage && (urlStage in STAGE_META)) return urlStage as StageKey
  if (!taskType) return "repeat"
  const t = taskType.toLowerCase()
  if (t === "listenrepeat" || t === "repeat") return "repeat"
  if (t === "readaloud" || t === "read-aloud") return "read-aloud"
  if (t === "sentenceframe" || t === "sentence") return "sentence"
  if (t === "freerecall" || t === "free-speak") return "free-speak"
  if (t === "review") return "review"
  if (t === "listen") return "listen"
  return "repeat"
}

export default function PracticePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const urlStage = searchParams.get("stage")
  const urlWordId = searchParams.get("wordId")
  const assignmentId = searchParams.get("assignmentId")
  const [data, setData] = useState<PracticeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [recording, setRecording] = useState(false)
  const [scores, setScores] = useState<ScoreBreakdown | null>(null)
  const [listenDone, setListenDone] = useState(false)
  const [revealed, setRevealed] = useState(false)  // Review stage: reveal the English word
  const [feedback, setFeedback] = useState<FullFeedback | null>(null)
  const [metrics, setMetrics] = useState<FluencyMetrics | null>(null)
  const [freeSpeakMeta, setFreeSpeakMeta] = useState<FreeSpeakMetadata | null>(null)
  const [azureWords, setAzureWords] = useState<WordScore[] | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [speaking_, setSpeaking] = useState(false)
  const [showEngineSelector, setShowEngineSelector] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [pauseWarning, setPauseWarning] = useState(false)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const [liveTranscript, setLiveTranscript] = useState<string>("")
  const interimUnsubRef = useRef<(() => void) | null>(null)
  // Fluency metrics: log pauses between interim transcript updates
  const pauseEventsRef = useRef<{ at: number; durationMs: number }[]>([])
  const lastInterimAtRef = useRef<number>(0)
  const recordStartRef = useRef<number>(0)

  // Speech engine
  const [engineId, setEngineId] = useState<STTEngineId>(DEFAULT_ENGINE_ID)
  const [sttError, setSttError] = useState<{ engine: string; message: string } | null>(null)
  const [engineLoading, setEngineLoading] = useState(false)
  const [azureConfigured, setAzureConfigured] = useState(false)
  const engineRef = useRef<SpeechEngine | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!user || user.role?.toLowerCase() !== "student") return
    fetch("/api/onboarding")
      .then((response) => response.json())
      .then((state) => {
        if (state.notAStudent || state.hasDiagnostic) return
        const skippedThisSession = sessionStorage.getItem(DIAGNOSTIC_SKIP_KEY) === "1"
        if (!skippedThisSession) router.replace("/onboarding/diagnostic")
      })
      .catch(() => {})
  }, [user, router])

  // Pause detection - configurable from admin STT settings
  const [pauseWarningSeconds, setPauseWarningSeconds] = useState(3)
  const [scoredPauseThresholdMs, setScoredPauseThresholdMs] = useState(1000)
  const [hasWebGPU, setHasWebGPU] = useState<boolean | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    if (saved) { setEngineId(saved); engineRef.current = getSpeechEngine(saved) }
    else { setEngineId(DEFAULT_ENGINE_ID); engineRef.current = getDefaultEngine() }
    // Warm up the offline STT model + the TTS voice shortly after first paint
    // (deferred so it never janks the initial render). This makes the first
    // "Listen" play the Kokoro voice instantly instead of lagging or falling back.
    const warmId = setTimeout(() => {
      const prep = engineRef.current?.prepare
      if (prep) {
        setEngineLoading(true)
        prep.call(engineRef.current).catch(() => {}).finally(() => setEngineLoading(false))
      }
      prepareActiveTts().catch(() => {})
    }, 1500)

    // Check WebGPU once + whether Azure pronunciation scoring is configured.
    checkWebGPU().then((ok) => setHasWebGPU(ok))
    isPronunciationConfigured().then(setAzureConfigured).catch(() => {})

    // Load pause warning timeout from admin settings
    fetch("/api/settings").then(r => r.json()).then(s => {
      if (s.stt_pause_warning_seconds) {
        const sec = Number(s.stt_pause_warning_seconds)
        if (!Number.isNaN(sec) && sec > 0) setPauseWarningSeconds(sec)
      }
      if (s.stt_scored_pause_threshold_ms) setScoredPauseThresholdMs(Math.max(500, Math.min(3000, Number(s.stt_scored_pause_threshold_ms))))
    }).catch(() => {})

    fetch("/api/practice").then(r => r.json()).then(d => {
      setData(d)
      if (d?.tasks?.length) {
        const requestedWordId = urlWordId ? Number(urlWordId) : 0
        if (Number.isInteger(requestedWordId) && requestedWordId > 0) {
          const wordIdx = d.tasks.findIndex((t: Task) =>
            t.vocabularyItemId === requestedWordId
            && (!urlStage || resolveStage(t.taskType, urlStage) === urlStage),
          )
          if (wordIdx >= 0) {
            setCurrentIndex(wordIdx)
            return
          }
        }
        const attemptedIds = new Set(d.attempts.map((a: { practiceTaskId: number }) => a.practiceTaskId))
        const idx = d.tasks.findIndex((t: Task) => !attemptedIds.has(t.id))
        if (idx >= 0) setCurrentIndex(idx)
      }
    }).catch(() => {}).finally(() => setLoading(false))

    return () => {
      clearTimeout(warmId)
      if (timerRef.current) clearInterval(timerRef.current)
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [])

  const switchEngine = (id: STTEngineId) => {
    setEngineId(id); engineRef.current = getSpeechEngine(id)
    localStorage.setItem("stt-engine", id); setShowEngineSelector(false)
  }

  const currentTask = data?.tasks?.[currentIndex]
  const currentVocab = currentTask?.vocabularyItemId
    ? data?.vocabulary.find(v => v.id === currentTask.vocabularyItemId) : null

  /** Resolved stage: URL param > task type > default repeat */
  const stage = useMemo(() => resolveStage(currentTask?.taskType, urlStage), [currentTask?.taskType, urlStage])
  const stageMeta = STAGE_META[stage]

  /**
   * The target text the student is supposed to produce, depending on stage:
   *   - sentence  → the example sentence
   *   - free-speak → the word/phrase required inside the student's own sentence
   *   - others    → the word itself
   */
  const stageTarget = useMemo(() => {
    if (!currentVocab) return ""
    if (stage === "sentence") return currentVocab.exampleSentence ?? currentVocab.word
    return currentVocab.word
  }, [stage, currentVocab])

  /** Expected-answers JSON for the scorer, derived per-stage. */
  const stageExpectedAnswers = useMemo(() => {
    if (stage === "sentence" && currentVocab?.exampleSentence) {
      return JSON.stringify([currentVocab.exampleSentence])
    }
    if (stage === "free-speak") return null
    return currentTask?.expectedAnswers ?? null
  }, [stage, currentVocab, currentTask])

  const handleListen = useCallback(async () => {
    if (!currentVocab) return
    setSpeaking(true)
    // Sentence stage: speak the full example sentence; otherwise just the word
    await speak(stage === "sentence" && currentVocab.exampleSentence ? currentVocab.exampleSentence : currentVocab.word)
    setSpeaking(false)
  }, [currentVocab, stage])

  /** Listen-only stage: tap "Got it" to mark complete and move on (no recording).
   *  This stage is ear-training/exposure — the learner only listens, so we must
   *  NOT fabricate a pronunciation score or claim they "said" the word. */
  const handleListenStageComplete = useCallback(() => {
    if (data?.cycle?.id) {
      try {
        localStorage.setItem(`stage-complete-${data.cycle.id}-listen`, "true")
      } catch {}
    }
    setListenDone(true)
  }, [data?.cycle?.id])

  const handleStartRecording = useCallback(async () => {
    setScores(null); setListenDone(false); setRevealed(false); setFeedback(null); setMetrics(null); setFreeSpeakMeta(null); setAzureWords(null); setTranscript(null); setMicError(null); setSttError(null)
    setPauseWarning(false); setRecordingTime(0); setLiveTranscript("")
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
      setRecordedAudioUrl(null)
    }

    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
      setRecording(true)

      // Get the stream for visualization
      const stream = engineRef.current.getStream()
      setMicStream(stream)

      // Reset fluency pause tracking
      pauseEventsRef.current = []
      recordStartRef.current = Date.now()
      lastInterimAtRef.current = Date.now()

      // Subscribe to live interim transcripts (Web Speech API).
      // Each time the transcript advances, the gap since the last update is a
      // candidate pause — log it if it exceeds the silence threshold (~500ms).
      if (engineRef.current.onInterim) {
        interimUnsubRef.current = engineRef.current.onInterim((t) => {
          const now = Date.now()
          const gap = now - lastInterimAtRef.current
          if (gap >= 500 && lastInterimAtRef.current > recordStartRef.current) {
            pauseEventsRef.current.push({ at: now - recordStartRef.current, durationMs: gap })
          }
          lastInterimAtRef.current = now
          setLiveTranscript(t)
        })
      }

      // Start a parallel MediaRecorder for playback
      if (stream && typeof MediaRecorder !== "undefined") {
        try {
          recordedChunksRef.current = []
          const mr = new MediaRecorder(
            stream,
            MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
              ? { mimeType: "audio/webm;codecs=opus" }
              : undefined,
          )
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunksRef.current.push(e.data)
          }
          mr.start(200)
          mediaRecorderRef.current = mr
        } catch (recErr) {
          console.warn("MediaRecorder failed:", recErr)
        }
      }

      // Start recording timer
      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1)
      }, 1000)

      // Start pause detection
      pauseTimerRef.current = setTimeout(() => {
        setPauseWarning(true)
      }, pauseWarningSeconds * 1000)

    } catch (e) {
      console.error("Failed to start recording:", e)
      const errMsg = e instanceof Error ? e.message : "Microphone not available. Check browser permissions."
      recordClientSpeechReliabilityEvent({
        eventType: "recording",
        provider: engineRef.current?.name ?? engineId,
        route: "practice-recording-start",
        practiceStage: stage,
        practiceTaskId: currentTask?.id ?? null,
        success: false,
        errorCode: errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("denied") ? "permission-denied" : "recording-start-failed",
        metadata: { engine: engineRef.current?.name ?? engineId },
      })

      // If a WebAI engine failed, mark it broken and auto-fallback to Web Speech API
      if (engineId !== "web-speech-api" && (errMsg.includes("speech model") || errMsg.includes("offline") || errMsg.includes("WebGPU"))) {
        markEngineFailed(engineId)
        setMicError(`${errMsg}\n\nAutomatically switching to Web Speech API...`)
        switchEngine("web-speech-api")
        engineRef.current = getSpeechEngine("web-speech-api")
      } else {
        setMicError(errMsg)
      }
      setRecording(false)
    }
  }, [engineId, pauseWarningSeconds, currentTask?.id, stage])

  const handleStopRecording = useCallback(async () => {
    setRecording(false); setSubmitting(true)
    setPauseWarning(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (pauseTimerRef.current) { clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null }
    if (interimUnsubRef.current) { interimUnsubRef.current(); interimUnsubRef.current = null }

    // Stop the parallel MediaRecorder first to capture the audio — used both for
    // playback AND for Azure pronunciation assessment.
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
      if (!engineRef.current) { setTranscript(""); setMicStream(null); return }
      const sttStartedAt = Date.now()
      const result = await engineRef.current.stop()
      setMicStream(null)  // Clean up visualizer AFTER engine has stopped
      const actualTranscript = result.transcript
      setTranscript(actualTranscript)
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? engineId,
        route: "practice-engine-stop",
        practiceStage: stage,
        practiceTaskId: currentTask?.id ?? null,
        success: !!actualTranscript?.trim(),
        latencyMs: Date.now() - sttStartedAt,
        noSpeech: !actualTranscript?.trim() || result.errorCode === "no-speech",
        errorCode: actualTranscript?.trim() ? null : (result.errorCode ?? "no-speech"),
        metadata: { engine: engineRef.current?.name ?? engineId },
      })

      // Surface a structured STT outcome with the engine name, so an empty
      // result reads as an honest "we didn't hear you" — not a silent 0% that
      // looks like the student was marked wrong.
      const engineName = engineRef.current?.name ?? "Speech engine"
      if (!actualTranscript || actualTranscript.trim().length === 0) {
        setSttError({ engine: engineName, message: result.errorMessage ?? "We didn't hear any speech. Move closer to the mic, then tap Speak to try again." })
      } else {
        setSttError(null)
      }

      const masteryRecord = currentVocab
        ? data?.mastery.find(m => m.vocabularyItemId === currentVocab.id) : null

      const cefr = ((data?.student?.cefrBand ?? data?.book?.cefrLevel) as "A1" | "A2" | "B1" | "B2") ?? "A1"
      const durationSec = recordingTime || 2

      // Compute rich fluency metrics from the captured pause events
      const fluencyMetrics = computeFluencyMetrics({
        transcript: actualTranscript,
        audioDurationSeconds: durationSec,
        pauseEvents: pauseEventsRef.current,
        wordTimings: result.wordTimings,
        scoredPauseThresholdMs,
        cefrBand: cefr,
      })
      setMetrics(fluencyMetrics)

      const scoreResult = calculateScore({
        transcript: actualTranscript,
        expectedAnswersJson: stageExpectedAnswers,
        spokenPhonemes: null,
        referencePhonemes: currentVocab?.phonemeString ?? null,
        audioDurationSeconds: durationSec,
        bestPreviousScore: masteryRecord?.bestScore ?? 0,
        latestPreviousScore: masteryRecord?.latestScore ?? 0,
        previousAttemptCount: masteryRecord?.timesSpoken ?? 0,
        cefrBand: cefr,
        fluencyMetrics,
      })

      // Transcript-based diagnostic feedback (the default / fallback).
      let expectedList: string[] = []
      try {
        const parsed = stageExpectedAnswers ? JSON.parse(stageExpectedAnswers) : []
        if (Array.isArray(parsed)) expectedList = parsed
      } catch { /* ignore */ }
      if (expectedList.length === 0 && currentVocab?.word && stage !== "free-speak") expectedList = [currentVocab.word]

      let finalScores = scoreResult
      let finalFeedback = generateFeedback(scoreResult, actualTranscript, expectedList, durationSec)
      let finalTranscript = actualTranscript
      let freeSpeakMetadata: FreeSpeakMetadata | null = null
      let pronunciationWeakWords: PronunciationWeakWordEvidence[] = []
      let pronunciationAssessment: unknown = null

      // Grab the recording (for playback + Azure).
      const recordingBlob = await recordingBlobPromise
      if (recordingBlob) setRecordedAudioUrl(URL.createObjectURL(recordingBlob))

      // ── Azure Pronunciation Assessment (when configured) ──────────────────
      // Real phoneme-level scoring for reference-text stages. Falls back to the
      // transcript-based scores above when Azure isn't set up or the call fails.
      if (recordingBlob && actualTranscript && stage !== "free-speak" && stageTarget && (await isPronunciationConfigured())) {
        const azure = await assessPronunciation(recordingBlob, stageTarget, cefr, scoreResult.consistency)
        if (azure === NO_SPEECH) {
          // Azure is the authority on reference stages. If it heard no clear
          // matching speech, the Groq transcript was almost certainly a
          // hallucination (e.g. "red" on silence) — score it as no-speech
          // instead of keeping a fake perfect result.
          finalScores = { targetMatch: 0, pronunciation: 0, fluency: 0, completeness: 0, consistency: 0, composite: 0 }
          finalFeedback = generateFeedback(finalScores, "", expectedList, durationSec)
          finalTranscript = ""
          setTranscript("")
          setAzureWords(null)
          setSttError({ engine: "Azure", message: "We couldn't make out clear speech for this word — please try again." })
        } else if (azure) {
          pronunciationAssessment = azure
          setSttError(null)
          // NEVER replace what the learner actually said with Azure's text.
          // Azure runs WITH the reference word, so its recognized text is
          // reference-aligned (it echoes the target — that's why saying "speak"
          // for "go" showed "You said: go"). Forced alignment also can't tell a
          // WRONG word from a mispronounced right one, so its targetMatch is
          // ~100% even for a recall miss. Therefore:
          //   • keep the free transcript (Groq) as "You said" — the honest record;
          //   • only trust Azure's pronunciation score when the free transcript
          //     actually matches the target, so a wrong word scores as wrong
          //     (not 30%) instead of borrowing Azure's forced-alignment credit.
          if (scoreResult.targetMatch >= 0.5) {
            finalScores = azure.breakdown
            finalFeedback = azure.feedback
            setAzureWords(azure.words)
            pronunciationWeakWords = pronunciationWeakWordsFromAzureWords(azure.words, stage)
          } else {
            finalScores = scoreResult
            finalFeedback = generateFeedback(scoreResult, actualTranscript, expectedList, durationSec)
            setAzureWords(null)
          }
        }
        // azure === null → Azure unavailable; keep the transcript-based score.
      }

      if (stage === "free-speak") {
        let aiGrade: FreeSpeakAiGrade = { coherence: null, aiAvailable: false }
        if (actualTranscript) {
          try {
            const res = await fetch("/api/practice/content-grade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: actualTranscript,
                topic: `Vocabulary Free Speak for "${currentVocab?.word ?? ""}". Judge coherence only; the app checks target vocabulary use separately.`,
                fluencyMetrics,
              }),
            })
            const g = await res.json()
            aiGrade = {
              coherence: typeof g?.coherence === "number" ? g.coherence : null,
              reason: typeof g?.reason === "string" ? g.reason : null,
              fluencyComment: typeof g?.fluencyComment === "string" ? g.fluencyComment : null,
              aiAvailable: g?.aiAvailable === true,
              provider: typeof g?.provider === "string" ? g.provider : null,
              model: typeof g?.model === "string" ? g.model : null,
            }
          } catch {
            aiGrade = { coherence: null, aiAvailable: false }
          }
        }

        const free = scoreFreeSpeak({
          transcript: actualTranscript,
          targetText: currentVocab?.word ?? null,
          requireTargetText: true,
          audioDurationSeconds: durationSec,
          cefrBand: cefr,
          fluencyMetrics,
          aiGrade,
          bestPreviousScore: masteryRecord?.bestScore ?? 0,
          latestPreviousScore: masteryRecord?.latestScore ?? 0,
          previousAttemptCount: masteryRecord?.timesSpoken ?? 0,
        })
        finalScores = free.scores
        finalFeedback = free.feedback
        freeSpeakMetadata = free.metadata
        setFreeSpeakMeta(free.metadata)
        setAzureWords(null)
        if (free.metadata.warning && actualTranscript) {
          setSttError({ engine: "AI", message: free.metadata.warning })
        } else if (actualTranscript) {
          setSttError(null)
        }
      }

      setScores(finalScores)
      setFeedback(finalFeedback)

      if (data?.cycle && data?.book && currentTask) {
        let audioPath: string | undefined
        if (recordingBlob) {
          const form = new FormData()
          form.append("audio", recordingBlob, `attempt.${recordingBlob.type.includes("wav") ? "wav" : "webm"}`)
          const upload = await fetch("/api/audio", { method: "POST", body: form })
          if (upload.ok) {
            const uploaded = await upload.json()
            if (typeof uploaded?.key === "string") audioPath = uploaded.key
          }
        }
        const saveResponse = await fetch("/api/practice/attempt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cycleId: data.cycle.id, bookId: data.book.id,
            practiceTaskId: currentTask.id, rawTranscript: finalTranscript,
            audioPath,
            targetMatchScore: finalScores.targetMatch,
            pronunciationScore: finalScores.pronunciation,
            fluencyScore: finalScores.fluency,
            completenessScore: finalScores.completeness,
            consistencyScore: finalScores.consistency,
            compositeScore: finalScores.composite,
            metricsJson: JSON.stringify({
              ...fluencyMetrics,
              practiceStage: stage,
              expectedText: stageTarget,
              freeSpeak: freeSpeakMetadata,
              pronunciationWeakWords,
              pronunciationAssessment,
              pronunciationProvider: pronunciationAssessment ? "azure" : "basic-transcript",
            }),
          }),
        })
        if (saveResponse.ok) {
          const saved = await saveResponse.json().catch(() => null)
          if (saved?.score) {
            setScores(saved.score)
            if (saved?.feedback) setFeedback(saved.feedback)
            if (saved?.freeSpeak) setFreeSpeakMeta(saved.freeSpeak)
          }
        }
      }
    } catch (err) {
      console.error("Recording error:", err)
      recordClientSpeechReliabilityEvent({
        eventType: "stt",
        provider: engineRef.current?.name ?? engineId,
        route: "practice-engine-stop",
        practiceStage: stage,
        practiceTaskId: currentTask?.id ?? null,
        success: false,
        errorCode: "engine-stop-failed",
        metadata: { message: err instanceof Error ? err.message.slice(0, 120) : "Unknown stop error" },
      })
      setMicStream(null)
      setTranscript("")
      const errScore = calculateScore({
        transcript: "", expectedAnswersJson: currentTask?.expectedAnswers ?? null,
        spokenPhonemes: null, referencePhonemes: null,
        audioDurationSeconds: 0, bestPreviousScore: 0, latestPreviousScore: 0,
        previousAttemptCount: 0, cefrBand: "A1",
      })
      setScores(errScore)
      setFeedback(generateFeedback(errScore, "", currentVocab?.word ? [currentVocab.word] : [], 0))
    } finally { setSubmitting(false) }
  }, [currentVocab, currentTask, data, engineId, recordingTime, scoredPauseThresholdMs, stage, stageExpectedAnswers, stageTarget])

  const clearRecordedAudio = () => {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl)
      setRecordedAudioUrl(null)
    }
  }
  const handleNext = () => {
    clearRecordedAudio()
    setScores(null); setListenDone(false); setRevealed(false); setFeedback(null); setMetrics(null); setFreeSpeakMeta(null); setAzureWords(null); setTranscript(null); setRecordingTime(0); setSttError(null)
    if (assignmentId) {
      router.push("/practice/hub")
      return
    }
    if (data?.tasks && currentIndex < data.tasks.length - 1) setCurrentIndex(i => i + 1)
    else router.push("/practice/hub")
  }
  const handleRetry = () => {
    clearRecordedAudio()
    setScores(null); setListenDone(false); setRevealed(false); setFeedback(null); setMetrics(null); setFreeSpeakMeta(null); setAzureWords(null); setTranscript(null); setRecordingTime(0); setSttError(null)
  }
  const handleShadowModelAnswer = (text: string) => {
    void speak(text)
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  if (!data?.cycle || !data?.tasks?.length) return <div className="p-6 text-center"><p className="text-muted-foreground">No practice tasks available.</p></div>

  const progress = ((currentIndex + 1) / data.tasks.length) * 100
  const engineInfo = STT_ENGINE_OPTIONS.find(e => e.id === engineId)

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/practice/hub")} className="text-muted-foreground hover:text-foreground transition"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowEngineSelector(!showEngineSelector)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition rounded-md border border-border px-2 py-1" title="Speech recognition engine">
            <Settings2 size={12} /> {engineInfo?.name ?? "STT"}
            {engineInfo?.offline && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded">offline</span>}
          </button>
          <span className="text-sm text-muted-foreground">{currentIndex + 1} / {data.tasks.length}</span>
        </div>
      </div>

      {/* Engine selector */}
      {showEngineSelector && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-lg space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Speech Recognition Engine</p>
          {hasWebGPU === false && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              Offline engines need WebGPU which isn&apos;t supported on this device. Stick with the Web Speech API engine.
            </div>
          )}
          {STT_ENGINE_OPTIONS.map((opt) => {
            const disabled = opt.offline && hasWebGPU === false
            const qColor = opt.quality === "Excellent" ? "bg-emerald-500/20 text-emerald-400" : opt.quality === "Very Good" ? "bg-blue-500/20 text-blue-400" : opt.quality === "Good" ? "bg-yellow-500/20 text-yellow-400" : "bg-orange-500/20 text-orange-400"
            const sColor = (opt.speed === "Very Fast" || opt.speed === "Real-time") ? "bg-emerald-500/20 text-emerald-400" : opt.speed === "Fast" ? "bg-blue-500/20 text-blue-400" : opt.speed === "Medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
            return (
              <button
                key={opt.id}
                onClick={() => !disabled && switchEngine(opt.id)}
                disabled={disabled}
                title={disabled ? "Requires WebGPU (not supported on this device)" : undefined}
                className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition ${
                  disabled
                    ? "border-border bg-muted/30 cursor-not-allowed opacity-50"
                    : engineId === opt.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{opt.name}</span>
                    <span className="text-xs text-muted-foreground">{opt.size}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${qColor}`}>{opt.quality}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sColor}`}>{opt.speed}</span>
                    {disabled ? (
                      <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Unavailable</span>
                    ) : opt.offline ? (
                      <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">Offline</span>
                    ) : (
                      <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">Internet Required</span>
                    )}
                  </div>
                </div>
                {engineId === opt.id && !disabled && <span className="text-primary font-bold">&#10003;</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Mic error */}
      {micError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertTriangle size={16} /> <span>{micError}</span>
        </div>
      )}

      {/* Stage instruction banner — distinct per stage */}
      <div className={`rounded-xl border p-4 ${stageMeta.accent}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/50 ${stageMeta.accentText}`}>
            <stageMeta.icon size={20} />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <h2 className={`text-sm font-bold ${stageMeta.accentText}`}>{stageMeta.title}</h2>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">{stageMeta.skill}</span>
            </div>
            <p className="text-sm text-foreground/90">{stageMeta.instruction}</p>
          </div>
        </div>
      </div>

      {/* Stage body — a different presentation for each stage */}
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm text-center space-y-3">
        {stageMeta.mode === "sentence" && currentVocab?.exampleSentence ? (
          <>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Read this sentence aloud</p>
            <p className="text-2xl font-medium text-foreground leading-relaxed">
              {highlightWordInSentence(currentVocab.exampleSentence, currentVocab.word)}
            </p>
            <p className="text-sm text-muted-foreground">Target word: <span className="font-mono text-primary">{currentVocab.word}</span></p>
          </>
        ) : stageMeta.mode === "free" ? (
          <>
            <div className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400"><Sparkles size={12} /> Use it in your own sentence</div>
            <h2 className="text-4xl font-bold text-foreground">{currentVocab?.word ?? "—"}</h2>
            {currentVocab?.arabicMeaning && <p className="text-lg text-muted-foreground" dir="rtl">{currentVocab.arabicMeaning}</p>}
            <p className="text-sm text-muted-foreground">
              Use <span className="font-semibold text-foreground">{currentVocab?.word}</span> in your own sentence. There is no single right answer, but the sentence must include this vocabulary item.
            </p>
          </>
        ) : stageMeta.mode === "review" ? (
          <>
            <p className="text-xs uppercase tracking-wider font-semibold text-rose-400">Recall test — no hints</p>
            <p className="text-sm text-muted-foreground">Say the English word for:</p>
            {currentVocab?.arabicMeaning
              ? <p className="text-3xl font-bold text-foreground" dir="rtl">{currentVocab.arabicMeaning}</p>
              : <p className="text-base italic text-muted-foreground">&ldquo;{currentVocab?.exampleSentence}&rdquo;</p>}
            <div className="pt-1">
              {(revealed || scores)
                ? <p className="text-2xl font-bold text-primary">{currentVocab?.word}</p>
                : <button onClick={() => setRevealed(true)} className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground">Reveal answer</button>}
            </div>
          </>
        ) : stageMeta.mode === "listen" ? (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/10 text-sky-400"><Ear size={28} /></div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Listen and recognise</p>
            <h2 className="text-4xl font-bold text-foreground">{currentVocab?.word ?? "—"}</h2>
            {currentVocab?.arabicMeaning && <p className="text-lg text-muted-foreground" dir="rtl">{currentVocab.arabicMeaning}</p>}
          </>
        ) : stageMeta.mode === "read" ? (
          <>
            <p className="text-xs uppercase tracking-wider font-semibold text-amber-400">Read it yourself — no audio</p>
            <h2 className="text-4xl font-bold text-foreground">{currentVocab?.word ?? "—"}</h2>
            {currentVocab?.phonemeString && <p className="font-mono text-sm text-muted-foreground">/{currentVocab.phonemeString}/</p>}
            {currentVocab?.arabicMeaning && <p className="text-lg text-muted-foreground" dir="rtl">{currentVocab.arabicMeaning}</p>}
          </>
        ) : (
          <>
            <div className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400"><Volume2 size={12} /> Listen, then repeat</div>
            <h2 className="text-4xl font-bold text-foreground">{currentVocab?.word ?? "—"}</h2>
            {currentVocab?.arabicMeaning && <p className="text-lg text-muted-foreground" dir="rtl">{currentVocab.arabicMeaning}</p>}
            {currentVocab?.exampleSentence && <p className="text-sm text-muted-foreground italic">{currentVocab.exampleSentence}</p>}
          </>
        )}
      </div>

      {/* Audio Visualizer + Live Transcript (while recording) */}
      {recording && (
        <div className="flex flex-col items-center gap-3">
          <AudioVisualizer stream={micStream} isRecording={recording} />
          <div className="flex items-center gap-4">
            <span className="text-sm font-mono text-muted-foreground">
              {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
            </span>
          </div>

          {/* Live transcript (Web Speech API surfaces interim results) */}
          {liveTranscript ? (
            <div className="w-full max-w-2xl rounded-lg border border-primary/30 bg-primary/5 p-3 text-center">
              <p className="text-[0.65rem] uppercase tracking-wider text-primary mb-1">Live transcript</p>
              <p className="text-base font-medium text-foreground">
                {liveTranscript}
                <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-primary" />
              </p>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {engineId === "web-speech-api" ? "Listening..." : "Recording (transcript will appear after stop)"}
            </div>
          )}

          {/* Pause warning */}
          {pauseWarning && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400 animate-pulse">
              <AlertTriangle size={14} />
              <span>Long pause detected — speak now or tap Stop</span>
            </div>
          )}
        </div>
      )}

      {/* Controls — stage-dependent */}
      {!scores && !listenDone ? (
        stage === "listen" ? (
          // Listen-only stage: just play & confirm — no mic
          <div className="flex items-center justify-center gap-4">
            <button onClick={handleListen} disabled={speaking_}
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50 shadow-lg shadow-primary/25">
              <Volume2 size={18} /> {speaking_ ? "Playing..." : "Play"}
            </button>
            <button onClick={handleListenStageComplete}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition">
              Got it <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex items-center justify-center gap-4">
              {stageMeta.showListenButton && (
                <button onClick={handleListen} disabled={speaking_ || recording}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition disabled:opacity-50">
                  <Volume2 size={16} /> {speaking_ ? "Playing..." : "Listen"}
                </button>
              )}
              {!recording ? (
                <button onClick={handleStartRecording} disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50 shadow-lg shadow-primary/25">
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                  {submitting ? "Transcribing..." : "Speak"}
                </button>
              ) : (
                <button onClick={handleStopRecording}
                  className="flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 text-sm font-semibold text-white transition shadow-lg shadow-red-500/25">
                  <MicOff size={18} /> Stop
                </button>
              )}
            </div>
            {/* Active engines — transparency: speech-to-text + pronunciation scorer */}
            {(() => {
              const opt = STT_ENGINE_OPTIONS.find(o => o.id === engineId)
              const sttName = opt?.id === "groq-whisper" ? "Groq Whisper" : (opt?.name ?? engineId)
              const isRefStage = stageMeta.mode !== "free"
              return (
                <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[0.7rem] text-muted-foreground">
                  <span className="flex items-center gap-1"><Mic size={11} /> Speech: <span className="font-medium text-foreground/80">{sttName}</span></span>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-1">
                    Pronunciation:{" "}
                    {azureConfigured && isRefStage
                      ? <span className="font-medium text-rose-400">Azure (active)</span>
                      : azureConfigured
                        ? <span className="font-medium text-muted-foreground">Azure (n/a on free speak)</span>
                        : <span className="font-medium text-amber-400">basic (no Azure key)</span>}
                  </span>
                  {engineLoading && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <Loader2 size={10} className="animate-spin" /> loading model…
                    </span>
                  )}
                </p>
              )
            })()}
          </div>
        )
      ) : listenDone ? (
        // Listen stage is ear-training, not speaking — acknowledge the exposure
        // honestly without any fabricated "you said it" / pronunciation score.
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <Ear size={28} className="mx-auto mb-2 text-emerald-400" />
            <h3 className="text-lg font-semibold text-foreground">You&apos;ve heard &ldquo;{currentVocab?.word ?? "it"}&rdquo;</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Listening trains your ear to recognise the word. When you&apos;re ready, the next stages let you practise saying it yourself.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => { setListenDone(false); handleListen() }} className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition">
              <Volume2 size={14} /> Play again
            </button>
            <button onClick={handleNext} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
              Next <ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm text-center">
            <p className="text-xs text-muted-foreground mb-1">You said:</p>
            <p className="text-lg font-medium text-foreground">{transcript ? `"${transcript}"` : "(no speech detected)"}</p>
            {transcript && currentVocab && stage !== "free-speak" && <p className="text-xs text-muted-foreground mt-1">Expected: &quot;{currentVocab.word}&quot;</p>}
          </div>
          {sttError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
              <MicOff size={16} className="mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">[{sttError.engine}]</span> {sttError.message}
              </div>
            </div>
          )}
          {recordedAudioUrl && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Volume2 size={14} className="text-blue-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Your recording</span>
              </div>
              <audio src={recordedAudioUrl} controls className="w-full h-9" />
              <p className="mt-1 text-[0.7rem] text-muted-foreground">Listen to verify what was actually captured.</p>
            </div>
          )}
          {scores && (
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <ScoreDisplay
                scores={scores}
                scoreHelp={stageMeta.mode === "free" ? FREE_SPEAK_COMPOSITE_HELP : STANDARD_SCORE_HELP}
                customRows={stageMeta.mode === "free" ? buildFreeSpeakRows(scores, freeSpeakMeta, currentVocab?.word) : undefined}
              />
            </div>
          )}
          {stage !== "free-speak" && scores && (
            azureWords && azureWords.length > 0
              ? <PronunciationBreakdown words={azureWords} />
              : <div className="rounded-lg border border-border bg-card p-4 shadow-sm"><div className="flex items-center gap-2"><Mic size={14} className="text-primary" /><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sound detail</h3></div><p className="mt-2 text-sm text-muted-foreground">{azureConfigured ? "Azure phoneme detail was unavailable for this attempt, so only basic transcript scoring was used." : "Azure Pronunciation Assessment is not configured. This attempt used basic transcript scoring, so word-by-word phoneme detail is not available."}</p></div>
          )}
          {/* Fluency metrics only make sense for multi-word tasks (sentences/free speech) */}
          {metrics && metrics.wordCount > 1 && (stageMeta.mode === "sentence" || stageMeta.mode === "free") && <FluencyMetricsCard metrics={metrics} />}
          {feedback && (
            <FeedbackPanel
              feedback={feedback}
              onTryAgain={handleRetry}
              onShadowModelAnswer={handleShadowModelAnswer}
            />
          )}
          <div className="flex items-center justify-center gap-3">
            <button onClick={handleRetry} className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition">
              <RotateCcw size={14} /> Try Again
            </button>
            <button onClick={handleNext} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
              Next <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

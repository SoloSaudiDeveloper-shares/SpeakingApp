"use client"

import { useState, useEffect, useCallback, useRef, use } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Mic,
  MicOff,
  BookOpen,
  ListPlus,
  History,
  FileText,
  CheckCircle,
  XCircle,
  MinusCircle,
} from "lucide-react"
import { getSpeechEngine, getDefaultEngine } from "@/lib/speech/speech-factory"
import type { SpeechEngine, STTEngineId } from "@/lib/speech/types"
import { compareTextToTranscript, type WordComparison, type TextComparisonResult } from "@/lib/scoring/text-comparison"

interface TextData {
  id: number
  studentId: number
  title: string
  originalText: string
  summary: string | null
  wordCount: number
  createdAt: string
  lastPracticedAt: string | null
  attempts: Array<{
    id: number
    spokenTranscript: string | null
    accuracyScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    weakWords: string
    attemptedAt: string
    durationSeconds: number
  }>
}

function ScoreBadge({ value, label }: { value: number; label: string }) {
  const color =
    value >= 80 ? "text-emerald-400" : value >= 50 ? "text-amber-400" : "text-red-400"
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}%</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

export default function TextPracticePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const textId = parseInt(id, 10)

  const [data, setData] = useState<TextData | null>(null)
  const [loading, setLoading] = useState(true)
  const [practicing, setPracticing] = useState(false)
  const [practiceTarget, setPracticeTarget] = useState<"full" | "summary">("full")
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [comparison, setComparison] = useState<TextComparisonResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savingList, setSavingList] = useState(false)
  const [listSaved, setListSaved] = useState(false)
  const [recordStart, setRecordStart] = useState<number>(0)

  const engineRef = useRef<SpeechEngine | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem("stt-engine") as STTEngineId | null
    if (saved) {
      engineRef.current = getSpeechEngine(saved)
    } else {
      engineRef.current = getDefaultEngine()
    }
  }, [])

  const loadText = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/text-practice/${textId}`)
      if (res.ok) {
        const d = await res.json()
        setData(d.text)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    if (!isNaN(textId)) loadText()
  }, [textId]) // eslint-disable-line react-hooks/exhaustive-deps

  const targetText =
    practiceTarget === "summary" && data?.summary
      ? data.summary
      : data?.originalText ?? ""

  const startPractice = (target: "full" | "summary") => {
    setPracticeTarget(target)
    setPracticing(true)
    setTranscript(null)
    setComparison(null)
    setListSaved(false)
  }

  const handleStartRecording = useCallback(async () => {
    setTranscript(null)
    setComparison(null)
    setRecording(true)
    setRecordStart(Date.now())
    try {
      if (!engineRef.current) engineRef.current = getDefaultEngine()
      await engineRef.current.start()
    } catch (e) {
      console.error("Failed to start recording:", e)
      setRecording(false)
    }
  }, [])

  const handleStopRecording = useCallback(async () => {
    setRecording(false)
    setSubmitting(true)
    const duration = (Date.now() - recordStart) / 1000

    try {
      if (!engineRef.current) {
        setTranscript("")
        setSubmitting(false)
        return
      }

      const result = await engineRef.current.stop()
      const spoken = result.transcript
      setTranscript(spoken)

      const compResult = compareTextToTranscript(targetText, spoken)
      setComparison(compResult)

      // Save attempt
      await fetch("/api/text-practice/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentTextId: textId,
          spokenTranscript: spoken,
          accuracyScore: compResult.accuracyScore,
          pronunciationScore: 0,
          fluencyScore: 0,
          completenessScore: compResult.completenessScore,
          weakWords: compResult.weakWords,
          durationSeconds: duration,
        }),
      })

      // Reload to get updated attempts
      loadText()
    } catch (e) {
      console.error("Recording error:", e)
    }
    setSubmitting(false)
  }, [targetText, textId, recordStart]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveWeakWords = async () => {
    if (!comparison || comparison.weakWords.length === 0) return
    setSavingList(true)
    try {
      const words = comparison.weakWords.map((w) => ({
        word: w,
        fromTextId: textId,
      }))
      const res = await fetch("/api/text-practice/word-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Weak words from: ${data?.title ?? "Text"}`,
          words,
        }),
      })
      if (res.ok) setListSaved(true)
    } catch { /* ignore */ }
    setSavingList(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Text not found.</p>
        <Link href="/practice/texts" className="text-primary hover:underline text-sm mt-2 inline-block">
          Back to Library
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/practice/texts" className="text-muted-foreground hover:text-foreground transition">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{data.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.wordCount} words | Created {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Original Text */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileText size={14} />
          Original Text
        </h2>
        <p className="text-foreground leading-relaxed whitespace-pre-wrap">{data.originalText}</p>
      </section>

      {/* Summary */}
      {data.summary && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <BookOpen size={14} />
            Summary
          </h2>
          <p className="text-foreground leading-relaxed">{data.summary}</p>
        </section>
      )}

      {/* Practice Buttons */}
      {!practicing && (
        <div className="flex gap-3">
          <button
            onClick={() => startPractice("full")}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            <Mic size={14} />
            Practice Full Text
          </button>
          {data.summary && (
            <button
              onClick={() => startPractice("summary")}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition"
            >
              <Mic size={14} />
              Practice Summary
            </button>
          )}
        </div>
      )}

      {/* Practice Area */}
      {practicing && (
        <section className="rounded-xl border border-primary/30 bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {practiceTarget === "summary" ? "Practicing Summary" : "Practicing Full Text"}
            </h2>
            <button
              onClick={() => {
                setPracticing(false)
                setTranscript(null)
                setComparison(null)
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition"
            >
              Exit Practice
            </button>
          </div>

          {/* Target text for reference */}
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted-foreground mb-2 font-medium">Read this text aloud:</p>
            <p className="text-foreground leading-relaxed whitespace-pre-wrap">{targetText}</p>
          </div>

          {/* Record Button */}
          <div className="flex justify-center">
            {recording ? (
              <button
                onClick={handleStopRecording}
                disabled={submitting}
                className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-white font-semibold hover:bg-red-600 transition animate-pulse"
              >
                <MicOff size={18} />
                Stop Recording
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                disabled={submitting}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-primary-foreground font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Mic size={18} />
                )}
                {submitting ? "Processing..." : "Start Recording"}
              </button>
            )}
          </div>

          {/* Transcript */}
          {transcript !== null && (
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground mb-2 font-medium">Your transcript:</p>
              <p className="text-foreground leading-relaxed">
                {transcript || <span className="text-muted-foreground italic">No speech detected</span>}
              </p>
            </div>
          )}

          {/* Scores */}
          {comparison && (
            <div className="space-y-4">
              <div className="flex justify-center gap-8 py-4">
                <ScoreBadge value={comparison.accuracyScore} label="Accuracy" />
                <ScoreBadge value={comparison.completenessScore} label="Completeness" />
              </div>

              {/* Word-by-word comparison */}
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="text-sm text-muted-foreground mb-3 font-medium">Word-by-word comparison:</p>
                <div className="flex flex-wrap gap-1">
                  {comparison.wordComparisons.map((w: WordComparison, i: number) => {
                    if (w.spoken === null) {
                      // Missing word
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm bg-muted/50 text-muted-foreground line-through"
                          title={`Missing: "${w.expected}"`}
                        >
                          <MinusCircle size={10} className="text-gray-400" />
                          {w.expected}
                        </span>
                      )
                    }
                    if (w.correct) {
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm bg-emerald-500/10 text-emerald-400"
                          title={`Correct: "${w.expected}"`}
                        >
                          <CheckCircle size={10} />
                          {w.expected}
                        </span>
                      )
                    }
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm bg-red-500/10 text-red-400"
                        title={`Expected "${w.expected}", heard "${w.spoken}"`}
                      >
                        <XCircle size={10} />
                        {w.expected}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Weak Words */}
              {comparison.weakWords.length > 0 && (
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-foreground">
                      Weak Words ({comparison.weakWords.length})
                    </p>
                    <button
                      onClick={handleSaveWeakWords}
                      disabled={savingList || listSaved}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {savingList ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : listSaved ? (
                        <CheckCircle size={12} />
                      ) : (
                        <ListPlus size={12} />
                      )}
                      {listSaved ? "Saved!" : "Create Word List"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {comparison.weakWords.map((w, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-sm text-red-400"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Attempt History */}
      {data.attempts && data.attempts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <History size={18} />
            Practice History
          </h2>
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/20">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Accuracy</th>
                  <th className="px-4 py-3 font-medium">Completeness</th>
                  <th className="px-4 py-3 font-medium">Weak Words</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.attempts.map((a) => {
                  const weakCount = (() => {
                    try {
                      return JSON.parse(a.weakWords).length
                    } catch {
                      return 0
                    }
                  })()
                  return (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-4 py-2.5 text-foreground">
                        {new Date(a.attemptedAt).toLocaleDateString()}{" "}
                        <span className="text-muted-foreground text-xs">
                          {new Date(a.attemptedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            a.accuracyScore >= 80
                              ? "text-emerald-400 font-medium"
                              : a.accuracyScore >= 50
                                ? "text-amber-400 font-medium"
                                : "text-red-400 font-medium"
                          }
                        >
                          {a.accuracyScore}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{a.completenessScore}%</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{weakCount}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {a.durationSeconds > 0 ? `${Math.round(a.durationSeconds)}s` : "--"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

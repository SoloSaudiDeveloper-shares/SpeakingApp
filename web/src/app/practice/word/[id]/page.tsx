"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, BookOpen, Award } from "lucide-react"

interface VocabData {
  vocabulary: {
    id: number
    word: string
    arabicMeaning: string | null
    partOfSpeech: string | null
    exampleSentence: string | null
    difficultyTier: number
    unit: number
  }
  attempts: Array<{
    id: number
    timestamp: string
    rawTranscript: string | null
    targetMatchScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    consistencyScore: number
    compositeScore: number
  }>
  mastery: {
    masteryStatus: string
    bestScore: number
    latestScore: number
    timesSeen: number
    timesSpoken: number
  } | null
}

function scoreBadge(value: number) {
  const pct = Math.round(value * 100)
  if (value >= 0.8) return <span className="text-emerald-400 font-medium">{pct}%</span>
  if (value >= 0.5) return <span className="text-amber-400 font-medium">{pct}%</span>
  return <span className="text-red-400 font-medium">{pct}%</span>
}

function masteryBadge(status: string) {
  const styles: Record<string, string> = {
    Mastered: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
    Developing: "bg-amber-500/20 border-amber-500/40 text-amber-300",
    Attempted: "bg-blue-500/20 border-blue-500/40 text-blue-300",
    NotStarted: "bg-muted/50 border-border text-muted-foreground",
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${styles[status] ?? styles.NotStarted}`}
    >
      <Award size={14} /> {status}
    </span>
  )
}

export default function PracticeWordPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [data, setData] = useState<VocabData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/practice/word/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.vocabulary) setData(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

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
        <Link
          href="/history"
          className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1"
        >
          <ArrowLeft size={16} /> Back to History
        </Link>
        <p className="mt-4 text-muted-foreground">Word not found.</p>
      </div>
    )
  }

  const { vocabulary, attempts, mastery } = data

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/history"
          className="text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Word Details</h1>
      </div>

      {/* Word info */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <BookOpen size={24} className="text-primary mt-1" />
            <div>
              <h2 className="text-3xl font-bold text-foreground">{vocabulary.word}</h2>
              {vocabulary.arabicMeaning && (
                <p className="text-lg text-muted-foreground mt-1">{vocabulary.arabicMeaning}</p>
              )}
            </div>
          </div>
          {mastery && masteryBadge(mastery.masteryStatus)}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-border">
          {vocabulary.partOfSpeech && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Part of Speech</p>
              <p className="text-foreground capitalize">{vocabulary.partOfSpeech}</p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Difficulty</p>
            <p className="text-foreground">Tier {vocabulary.difficultyTier}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Unit</p>
            <p className="text-foreground">{vocabulary.unit}</p>
          </div>
          {mastery && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Times Spoken</p>
              <p className="text-foreground">{mastery.timesSpoken}</p>
            </div>
          )}
        </div>

        {vocabulary.exampleSentence && (
          <div className="pt-3 border-t border-border">
            <p className="text-sm font-medium text-muted-foreground">Example Sentence</p>
            <p className="text-foreground italic mt-1">{vocabulary.exampleSentence}</p>
          </div>
        )}
      </div>

      {/* Attempts table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Attempts ({attempts.length})
          </h2>
        </div>

        {attempts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-muted-foreground font-medium">Date</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Transcript</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Composite</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Target</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Pronunciation</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Fluency</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Completeness</th>
                  <th className="px-4 py-3 text-muted-foreground font-medium">Consistency</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-border">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(a.timestamp).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[200px] truncate">
                      {a.rawTranscript || "-"}
                    </td>
                    <td className="px-4 py-3">{scoreBadge(a.compositeScore)}</td>
                    <td className="px-4 py-3">{scoreBadge(a.targetMatchScore)}</td>
                    <td className="px-4 py-3">{scoreBadge(a.pronunciationScore)}</td>
                    <td className="px-4 py-3">{scoreBadge(a.fluencyScore)}</td>
                    <td className="px-4 py-3">{scoreBadge(a.completenessScore)}</td>
                    <td className="px-4 py-3">{scoreBadge(a.consistencyScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-8 text-muted-foreground text-center">
            No attempts recorded for this word yet.
          </p>
        )}
      </div>
    </div>
  )
}

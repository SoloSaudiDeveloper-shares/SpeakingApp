"use client"

import { useState, useEffect } from "react"
import { Clock, Star, TrendingUp, BarChart3, Loader2 } from "lucide-react"

interface PracticeData {
  cycle: { id: number } | null
  vocabulary: Array<{ id: number; word: string }>
  tasks: Array<{ id: number; vocabularyItemId: number | null }>
  attempts: Array<{
    id: number
    practiceTaskId: number
    compositeScore: number
    targetMatchScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    consistencyScore: number
    timestamp: string
    rawTranscript: string | null
  }>
  mastery: Array<{ vocabularyItemId: number; masteryStatus: string; bestScore: number }>
}

export default function HistoryPage() {
  const [data, setData] = useState<PracticeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/practice")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  const totalAttempts = data?.attempts?.length ?? 0
  const mastered = data?.mastery?.filter((m) => m.masteryStatus === "Mastered").length ?? 0
  const developing = data?.mastery?.filter((m) => m.masteryStatus === "Developing").length ?? 0
  const avgScore = totalAttempts > 0
    ? (data!.attempts.reduce((s, a) => s + a.compositeScore, 0) / totalAttempts)
    : 0

  const stats = [
    { label: "Total Attempts", value: totalAttempts, icon: Clock, color: "text-blue-400" },
    { label: "Mastered", value: mastered, icon: Star, color: "text-emerald-400" },
    { label: "Developing", value: developing, icon: TrendingUp, color: "text-amber-400" },
    { label: "Avg Score", value: `${(avgScore * 100).toFixed(0)}%`, icon: BarChart3, color: "text-purple-400" },
  ]

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Practice History</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <s.icon size={16} className={s.color} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <p className="mt-1 text-xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Word Mastery Grid */}
      {data?.vocabulary && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-3">Word Mastery</h2>
          <div className="flex flex-wrap gap-2">
            {data.vocabulary.map((v) => {
              const m = data.mastery?.find((x) => x.vocabularyItemId === v.id)
              const status = m?.masteryStatus ?? "NotStarted"
              const bg = status === "Mastered"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                : status === "Developing"
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : status === "Attempted"
                    ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                    : "bg-muted/50 border-border text-muted-foreground"
              return (
                <span key={v.id} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${bg}`}>
                  {v.word}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Attempts Table */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground mb-3">All Attempts</h2>
        {totalAttempts === 0 ? (
          <p className="text-sm text-muted-foreground">No attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2">Word</th>
                  <th className="pb-2">Score</th>
                  <th className="pb-2">Match</th>
                  <th className="pb-2">Pron.</th>
                  <th className="pb-2">Fluency</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {data!.attempts.map((a) => {
                  const task = data!.tasks.find((t) => t.id === a.practiceTaskId)
                  const vocab = task?.vocabularyItemId
                    ? data!.vocabulary.find((v) => v.id === task.vocabularyItemId)
                    : null
                  return (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-2 text-foreground">{vocab?.word ?? "—"}</td>
                      <td className="py-2">
                        <span className={a.compositeScore >= 0.85 ? "text-emerald-400" : a.compositeScore >= 0.6 ? "text-amber-400" : "text-red-400"}>
                          {(a.compositeScore * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">{(a.targetMatchScore * 100).toFixed(0)}%</td>
                      <td className="py-2 text-muted-foreground">{(a.pronunciationScore * 100).toFixed(0)}%</td>
                      <td className="py-2 text-muted-foreground">{(a.fluencyScore * 100).toFixed(0)}%</td>
                      <td className="py-2 text-muted-foreground text-xs">{new Date(a.timestamp).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

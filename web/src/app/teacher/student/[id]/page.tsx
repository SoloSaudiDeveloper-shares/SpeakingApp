"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, BarChart3, TrendingUp, Award } from "lucide-react"

interface ReviewData {
  student: { id: number; fullName: string; cefrBand: string; class?: string | null }
  attempts: Array<{
    id: number
    compositeScore: number
    targetMatchScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    consistencyScore: number
    timestamp: string
    rawTranscript: string | null
    practiceTaskId: number
  }>
  mastery: Array<{
    vocabularyItemId: number
    masteryStatus: string
    bestScore: number
    vocabulary?: { word: string }
  }>
}

function pct(v: number) {
  return Math.round(v * 100)
}
function scoreColor(v: number) {
  if (v >= 0.8) return "text-emerald-400"
  if (v >= 0.5) return "text-amber-400"
  return "text-red-400"
}

export default function StudentReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/students/${id}/progress`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.student) {
          setData({ student: d.student, attempts: d.attempts ?? [], mastery: d.mastery ?? [] })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  if (!data) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/teacher" className="text-muted-foreground hover:text-foreground transition"><ArrowLeft size={20} /></Link>
          <h1 className="text-2xl font-bold text-foreground">Student Review</h1>
        </div>
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground">Student not found.</p>
        </div>
      </div>
    )
  }

  const { student, attempts, mastery } = data
  const total = attempts.length
  const avg = total > 0 ? attempts.reduce((s, a) => s + a.compositeScore, 0) / total : 0
  const best = total > 0 ? Math.max(...attempts.map((a) => a.compositeScore)) : 0
  const mastered = mastery.filter((m) => m.masteryStatus === "Mastered").length
  const recent = attempts.slice(0, 15)

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/teacher" className="text-muted-foreground hover:text-foreground transition"><ArrowLeft size={20} /></Link>
        <h1 className="text-2xl font-bold text-foreground">Student Review</h1>
      </div>

      {/* Student info */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-bold text-foreground">{student.fullName}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          CEFR: {student.cefrBand}
          {student.class ? ` · ${student.class}` : ""} · Student #{student.id}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <BarChart3 size={18} className="text-primary mx-auto mb-1.5" />
          <p className="text-2xl font-bold text-foreground">{total}</p>
          <p className="text-xs text-muted-foreground">Total Attempts</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <TrendingUp size={18} className="text-primary mx-auto mb-1.5" />
          <p className="text-2xl font-bold text-foreground">{pct(avg)}%</p>
          <p className="text-xs text-muted-foreground">Avg Score</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <Award size={18} className="text-primary mx-auto mb-1.5" />
          <p className="text-2xl font-bold text-foreground">{pct(best)}%</p>
          <p className="text-xs text-muted-foreground">Best Score</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <Award size={18} className="text-emerald-400 mx-auto mb-1.5" />
          <p className="text-2xl font-bold text-foreground">{mastered}</p>
          <p className="text-xs text-muted-foreground">Words Mastered</p>
        </div>
      </div>

      {/* Word Mastery */}
      {mastery.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-3">Word Mastery</h2>
          <div className="flex flex-wrap gap-2">
            {mastery.map((m, i) => {
              const bg = m.masteryStatus === "Mastered"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                : m.masteryStatus === "Developing"
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : "bg-muted/50 border-border text-muted-foreground"
              return (
                <span key={i} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${bg}`}>
                  {m.vocabulary?.word ?? `Word #${m.vocabularyItemId}`}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent attempts with transcripts */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent Attempts</h2>
        </div>
        {recent.length > 0 ? (
          <div className="divide-y divide-border">
            {recent.map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate font-mono">
                    {a.rawTranscript ? `"${a.rawTranscript}"` : <span className="text-muted-foreground italic">(no transcript)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className={`font-bold ${scoreColor(a.compositeScore)}`}>{pct(a.compositeScore)}%</span>
                  <Link href={`/teacher/attempt/${a.id}`} className="text-primary hover:underline">Review</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-muted-foreground text-center text-sm">No attempts yet.</p>
        )}
      </div>
    </div>
  )
}

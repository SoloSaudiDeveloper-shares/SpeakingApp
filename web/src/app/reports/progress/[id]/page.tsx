"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, TrendingUp, Target, Award, BarChart3 } from "lucide-react"

interface StudentProgress {
  student: { id: number; fullName: string; cefrBand: string } | null
  attempts: Array<{
    id: number
    timestamp: string
    compositeScore: number
    targetMatchScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    consistencyScore: number
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

function scoreBadge(value: number) {
  const pct = Math.round(value * 100)
  if (value >= 0.8) return <span className="text-emerald-400 font-medium">{pct}%</span>
  if (value >= 0.5) return <span className="text-amber-400 font-medium">{pct}%</span>
  return <span className="text-red-400 font-medium">{pct}%</span>
}

export default function ProgressReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [data, setData] = useState<StudentProgress | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load the student's full progress (profile + attempts + mastery)
    fetch(`/api/students/${id}/progress`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.student) {
          setData({
            student: d.student,
            attempts: d.attempts ?? [],
            mastery: d.mastery ?? [],
          })
        }
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

  if (!data?.student) {
    return (
      <div className="p-6">
        <Link
          href="/reports"
          className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1"
        >
          <ArrowLeft size={16} /> Back to Reports
        </Link>
        <p className="mt-4 text-muted-foreground">Student not found.</p>
      </div>
    )
  }

  const { student, attempts, mastery } = data
  const totalAttempts = attempts.length
  const avgComposite =
    totalAttempts > 0
      ? attempts.reduce((sum, a) => sum + a.compositeScore, 0) / totalAttempts
      : 0
  const bestComposite =
    totalAttempts > 0 ? Math.max(...attempts.map((a) => a.compositeScore)) : 0
  const wordsMastered = mastery.filter((m) => m.masteryStatus === "Mastered").length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/reports"
          className="text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Progress Report</h1>
      </div>

      {/* Student info */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-xl font-bold text-foreground">{student.fullName}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          CEFR Level: {student.cefrBand} &middot; Student #{student.id}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-center">
          <BarChart3 size={20} className="text-primary mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{totalAttempts}</p>
          <p className="text-sm text-muted-foreground">Total Attempts</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-center">
          <TrendingUp size={20} className="text-primary mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {Math.round(avgComposite * 100)}%
          </p>
          <p className="text-sm text-muted-foreground">Avg Composite</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-center">
          <Target size={20} className="text-primary mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {Math.round(bestComposite * 100)}%
          </p>
          <p className="text-sm text-muted-foreground">Best Score</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-center">
          <Award size={20} className="text-primary mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">{wordsMastered}</p>
          <p className="text-sm text-muted-foreground">Words Mastered</p>
        </div>
      </div>

      {/* Mastery overview */}
      {mastery.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-3">Word Mastery</h2>
          <div className="flex flex-wrap gap-2">
            {mastery.map((m, i) => {
              const bg =
                m.masteryStatus === "Mastered"
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                  : m.masteryStatus === "Developing"
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-muted/50 border-border text-muted-foreground"
              return (
                <span
                  key={i}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${bg}`}
                >
                  {m.vocabulary?.word ?? `Word #${m.vocabularyItemId}`}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Attempts table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">All Attempts</h2>
        </div>

        {attempts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-muted-foreground font-medium">Date</th>
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
            No attempts recorded yet. Data will appear here as the student completes practice tasks.
          </p>
        )}
      </div>
    </div>
  )
}

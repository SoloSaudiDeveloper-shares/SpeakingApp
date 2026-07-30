"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Save, Volume2 } from "lucide-react"

interface AttemptData {
  attempt: {
    id: number
    studentId: number
    practiceTaskId: number
    timestamp: string
    audioPath: string | null
    rawTranscript: string | null
    rescoredTranscript: string | null
    targetMatchScore: number
    pronunciationScore: number
    fluencyScore: number
    completenessScore: number
    consistencyScore: number
    compositeScore: number
    teacherOverrideScore: number | null
    teacherNotes: string | null
  }
  task: {
    id: number
    taskType: string
    prompt: string
    expectedAnswers: string | null
  } | null
  student: {
    id: number
    fullName: string
    cefrBand: string
  } | null
  vocabulary: {
    id: number
    word: string
    arabicMeaning: string | null
  } | null
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color =
    value >= 0.8
      ? "bg-emerald-500"
      : value >= 0.5
        ? "bg-amber-500"
        : "bg-red-500"

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function TeacherAttemptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [data, setData] = useState<AttemptData | null>(null)
  const [loading, setLoading] = useState(true)
  const [overrideScore, setOverrideScore] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/teacher/attempt/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.attempt) {
          setData(d)
          if (d.attempt.teacherOverrideScore != null) {
            setOverrideScore(String(Math.round(d.attempt.teacherOverrideScore * 100)))
          }
          if (d.attempt.teacherNotes) {
            setNotes(d.attempt.teacherNotes)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  const handleSaveOverride = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const scoreVal = parseInt(overrideScore, 10)
      if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100) {
        setSaving(false)
        return
      }
      await fetch(`/api/teacher/attempt/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: scoreVal / 100,
          notes,
        }),
      })
      setSaved(true)
    } catch {
      /* ignore */
    }
    setSaving(false)
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
        <Link href="/teacher" className="text-muted-foreground hover:text-foreground transition inline-flex items-center gap-1">
          <ArrowLeft size={16} /> Back
        </Link>
        <p className="mt-4 text-muted-foreground">Attempt not found.</p>
      </div>
    )
  }

  const { attempt, task, student, vocabulary } = data
  const compositeColor =
    attempt.compositeScore >= 0.8
      ? "text-emerald-400"
      : attempt.compositeScore >= 0.5
        ? "text-amber-400"
        : "text-red-400"

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/teacher"
          className="text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Attempt #{attempt.id}</h1>
      </div>

      {/* Student & task info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Student</h2>
          <p className="text-lg font-semibold text-foreground">
            {student?.fullName ?? `Student #${attempt.studentId}`}
          </p>
          {student && (
            <p className="text-sm text-muted-foreground">CEFR: {student.cefrBand}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {new Date(attempt.timestamp).toLocaleString()}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Task</h2>
          {task && (
            <>
              <p className="text-sm text-foreground">
                <span className="font-medium">{task.taskType}</span>
              </p>
              <p className="text-foreground">{task.prompt}</p>
              {task.expectedAnswers && (
                <p className="text-sm text-muted-foreground">
                  Expected: {task.expectedAnswers}
                </p>
              )}
            </>
          )}
          {vocabulary && (
            <p className="text-sm text-muted-foreground">
              Word: <span className="text-foreground font-medium">{vocabulary.word}</span>
              {vocabulary.arabicMeaning && ` (${vocabulary.arabicMeaning})`}
            </p>
          )}
        </div>
      </div>

      {/* Transcript */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Student Response</h2>
        <p className="text-foreground font-mono text-sm bg-muted/30 rounded-md p-3">
          {attempt.rawTranscript || "(no transcript)"}
        </p>
        {attempt.rescoredTranscript && attempt.rescoredTranscript !== attempt.rawTranscript && (
          <>
            <h3 className="text-sm font-medium text-muted-foreground mt-2">Rescored Transcript</h3>
            <p className="text-foreground font-mono text-sm bg-muted/30 rounded-md p-3">
              {attempt.rescoredTranscript}
            </p>
          </>
        )}
      </div>

      {/* Audio */}
      {attempt.audioPath && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Volume2 size={16} /> Audio Recording
          </h2>
          <audio controls className="w-full">
            <source src={`/api/attempts/${attempt.id}/audio`} />
            Your browser does not support audio playback.
          </audio>
        </div>
      )}

      {/* Scores */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Scores</h2>
          <span className={`text-2xl font-bold ${compositeColor}`}>
            {Math.round(attempt.compositeScore * 100)}%
          </span>
        </div>
        <ScoreBar label="Target Match" value={attempt.targetMatchScore} />
        <ScoreBar label="Pronunciation" value={attempt.pronunciationScore} />
        <ScoreBar label="Fluency" value={attempt.fluencyScore} />
        <ScoreBar label="Completeness" value={attempt.completenessScore} />
        <ScoreBar label="Consistency" value={attempt.consistencyScore} />
      </div>

      {/* Teacher override */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Teacher Override</h2>
        {attempt.teacherOverrideScore != null && (
          <p className="text-sm text-muted-foreground">
            Current override: {Math.round(attempt.teacherOverrideScore * 100)}%
          </p>
        )}

        <div>
          <label className="text-sm font-medium text-muted-foreground">
            Override Score (0-100)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={overrideScore}
            onChange={(e) => setOverrideScore(e.target.value)}
            placeholder="e.g. 75"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-muted-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Teacher notes about this attempt..."
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveOverride}
            disabled={saving || !overrideScore}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "Saving..." : "Save Override"}
          </button>
          {saved && (
            <span className="text-sm text-emerald-400">Saved successfully</span>
          )}
        </div>
      </div>
    </div>
  )
}

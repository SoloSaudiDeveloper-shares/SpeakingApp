"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, FileAudio, Loader2, Volume2 } from "lucide-react"

interface AudioAttempt {
  id: number
  studentId: number
  studentName: string
  className: string | null
  timestamp: string
  audioPath: string
  transcript: string | null
  score: number
  taskType: string | null
  word: string | null
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function tone(value: number) {
  if (value >= 0.8) return "text-emerald-400"
  if (value >= 0.65) return "text-amber-400"
  return "text-red-400"
}

export default function AudioArchivePage() {
  const [attempts, setAttempts] = useState<AudioAttempt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/reports/audio")
      .then((r) => r.json())
      .then((d) => setAttempts(Array.isArray(d.audioAttempts) ? d.audioAttempts : []))
      .catch(() => setAttempts([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audio Review</h1>
          <p className="text-sm text-muted-foreground">Recordings from student speaking attempts.</p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <FileAudio size={42} className="mx-auto text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">No audio recordings are available yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {attempts.map((attempt) => (
            <div key={attempt.id} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{attempt.studentName}</p>
                  <p className="text-xs text-muted-foreground">
                    {attempt.className ?? "Unassigned"} - {new Date(attempt.timestamp).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {attempt.taskType ?? "Task"} {attempt.word ? `- ${attempt.word}` : ""}
                  </p>
                </div>
                <div className={`flex items-center gap-1 text-sm font-bold ${tone(attempt.score)}`}>
                  <Volume2 size={14} />
                  {pct(attempt.score)}
                </div>
              </div>
              {attempt.transcript && (
                <p className="mb-3 rounded-lg bg-muted/30 p-3 text-sm italic text-muted-foreground">
                  &quot;{attempt.transcript}&quot;
                </p>
              )}
              <audio controls className="w-full">
                <source src={`/api/attempts/${attempt.id}/audio`} />
              </audio>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

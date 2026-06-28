"use client"

import Link from "next/link"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function RecentAttemptsWidget({ data }: Props) {
  const recentAttempts = data.attempts.slice(0, 5)

  if (recentAttempts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No attempts yet. Start practicing!
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {recentAttempts.map((a) => {
          const task = data.tasks.find((t) => t.id === a.practiceTaskId)
          const vocab = task?.vocabularyItemId
            ? data.vocabulary.find((v) => v.id === task.vocabularyItemId)
            : null
          const scoreColor =
            a.compositeScore >= 0.8
              ? "bg-emerald-500"
              : a.compositeScore >= 0.5
                ? "bg-amber-500"
                : "bg-red-500"
          const scoreTextColor =
            a.compositeScore >= 0.8
              ? "text-emerald-400"
              : a.compositeScore >= 0.5
                ? "text-amber-400"
                : "text-red-400"

          return (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${scoreColor}`} />
                <span className="text-sm text-foreground font-medium">
                  {vocab?.word ?? "Unknown"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${scoreTextColor}`}>
                  {Math.round(a.compositeScore * 100)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {timeAgo(a.timestamp)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <Link
        href="/practice/history"
        className="inline-flex text-xs text-primary hover:underline"
      >
        View all attempts
      </Link>
    </div>
  )
}

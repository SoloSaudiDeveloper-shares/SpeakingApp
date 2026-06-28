"use client"

import { useState, useEffect } from "react"
import { Trophy, Medal, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/hooks/use-auth"

interface LeaderboardEntry {
  studentId: number
  displayName: string
  masteredCount: number
  rank: number
}

export function LeaderboardWidget() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/practice/leaderboard")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEntries(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No leaderboard data yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const isCurrentUser = entry.studentId === user?.studentId
        const rankIcon =
          entry.rank === 1 ? (
            <Trophy size={14} className="text-amber-400" />
          ) : entry.rank <= 3 ? (
            <Medal size={14} className="text-muted-foreground" />
          ) : null

        return (
          <div
            key={entry.studentId}
            className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
              isCurrentUser
                ? "bg-primary/10 border border-primary/30"
                : "border border-transparent hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                {entry.rank}
              </span>
              {rankIcon}
              <span className={`text-sm ${isCurrentUser ? "font-semibold text-foreground" : "text-foreground"}`}>
                {entry.displayName}
                {isCurrentUser && (
                  <span className="text-xs text-primary ml-1.5">(you)</span>
                )}
              </span>
            </div>
            <span className="text-sm font-semibold text-emerald-400">
              {entry.masteredCount}
            </span>
          </div>
        )
      })}
    </div>
  )
}

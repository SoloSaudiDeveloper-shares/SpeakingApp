"use client"

import { useMemo } from "react"
import { Flame, Target } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

export function StreaksWidget({ data }: Props) {
  const DAILY_GOAL = 10

  const { currentStreak, longestStreak, todayCount } = useMemo(() => {
    // Group attempts by date
    const byDate = new Map<string, number>()
    for (const a of data.attempts) {
      const date = a.timestamp.slice(0, 10) // YYYY-MM-DD
      byDate.set(date, (byDate.get(date) ?? 0) + 1)
    }

    // Today's count
    const today = new Date().toISOString().slice(0, 10)
    const todayCount = byDate.get(today) ?? 0

    // Calculate streaks by walking backwards from today
    const dates = Array.from(byDate.keys()).sort().reverse()
    let currentStreak = 0
    let longestStreak = 0
    let streak = 0
    let expectedDate = new Date()

    for (let i = 0; i < 365; i++) {
      const dateStr = expectedDate.toISOString().slice(0, 10)
      if (byDate.has(dateStr)) {
        streak++
        if (i === 0 || streak > 0) currentStreak = streak
      } else {
        if (i === 0) {
          // No practice today, but still count yesterday's streak
          expectedDate.setDate(expectedDate.getDate() - 1)
          continue
        }
        break
      }
      expectedDate.setDate(expectedDate.getDate() - 1)
    }

    // Recalculate longest streak from all sorted dates
    let ls = 0
    let tempStreak = 0
    const allDates = Array.from(byDate.keys()).sort()
    for (let i = 0; i < allDates.length; i++) {
      if (i === 0) {
        tempStreak = 1
      } else {
        const prev = new Date(allDates[i - 1])
        const curr = new Date(allDates[i])
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000)
        tempStreak = diffDays === 1 ? tempStreak + 1 : 1
      }
      ls = Math.max(ls, tempStreak)
    }

    return { currentStreak, longestStreak: ls, todayCount }
  }, [data.attempts])

  const goalProgress = Math.min(100, Math.round((todayCount / DAILY_GOAL) * 100))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={24} className="text-orange-400" />
          <div>
            <p className="text-2xl font-bold text-foreground">{currentStreak}</p>
            <p className="text-xs text-muted-foreground">day streak</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground">{longestStreak}</p>
          <p className="text-xs text-muted-foreground">best streak</p>
        </div>
      </div>

      {/* Daily goal */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Target size={12} />
          <span>Practice {DAILY_GOAL} words today</span>
          <span className="ml-auto font-medium text-foreground">{todayCount}/{DAILY_GOAL}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-400 transition-all duration-500"
            style={{ width: `${goalProgress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

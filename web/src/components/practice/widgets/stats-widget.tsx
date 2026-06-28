"use client"

import { useState, useEffect } from "react"
import { Star, TrendingUp, Clock, BarChart3 } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (value === 0) { setDisplay(0); return }
    const duration = 800
    const steps = 30
    const increment = value / steps
    let current = 0
    const interval = setInterval(() => {
      current += increment
      if (current >= value) {
        setDisplay(value)
        clearInterval(interval)
      } else {
        setDisplay(Math.round(current))
      }
    }, duration / steps)
    return () => clearInterval(interval)
  }, [value])

  return (
    <span>
      {display}{suffix}
    </span>
  )
}

export function StatsWidget({ data }: Props) {
  const totalWords = data.vocabulary.length
  const mastered = data.mastery.filter((m) => m.masteryStatus === "Mastered").length
  const developing = data.mastery.filter((m) => m.masteryStatus === "Developing").length
  const totalAttempts = data.attempts.length
  const avgScore =
    totalAttempts > 0
      ? Math.round(
          (data.attempts.reduce((sum, a) => sum + a.compositeScore, 0) / totalAttempts) * 100
        )
      : 0

  const stats = [
    {
      label: "Words Mastered",
      value: mastered,
      total: totalWords,
      suffix: `/${totalWords}`,
      icon: Star,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Developing",
      value: developing,
      suffix: "",
      icon: TrendingUp,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      label: "Total Attempts",
      value: totalAttempts,
      suffix: "",
      icon: Clock,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Avg Score",
      value: avgScore,
      suffix: "%",
      icon: BarChart3,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className={`rounded-lg ${s.bg} p-3 text-center`}>
          <s.icon size={20} className={`mx-auto ${s.color}`} />
          <p className="mt-2 text-2xl font-bold text-foreground">
            <AnimatedNumber value={s.value} suffix={s.suffix} />
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  )
}

"use client"

import Link from "next/link"
import { Mic, ArrowRight } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface Props {
  data: PracticeData
}

export function QuickPracticeWidget({ data }: Props) {
  const totalWords = data.vocabulary.length
  const mastered = data.mastery.filter((m) => m.masteryStatus === "Mastered").length
  const progressPercent = totalWords > 0 ? Math.round((mastered / totalWords) * 100) : 0

  // Find next word to practice (first non-mastered)
  const masteredIds = new Set(
    data.mastery.filter((m) => m.masteryStatus === "Mastered").map((m) => m.vocabularyItemId)
  )
  const nextWord = data.vocabulary.find((v) => !masteredIds.has(v.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Next up</p>
          <p className="text-lg font-bold text-foreground">
            {nextWord?.word ?? "All done!"}
          </p>
          {nextWord?.arabicMeaning && (
            <p className="text-xs text-muted-foreground">{nextWord.arabicMeaning}</p>
          )}
        </div>
        <Link
          href="/practice"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <Mic size={18} />
          Start
          <ArrowRight size={14} />
        </Link>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{mastered} of {totalWords} words mastered</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}

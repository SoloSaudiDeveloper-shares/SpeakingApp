"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, CheckCircle2, LibraryBig, Target } from "lucide-react"
import type { PracticeData } from "./widget-types"

interface KlpFocus {
  enabled: boolean
  activeCycle: {
    bookTitle: string | null
    cefrLevel: string | null
    vocabularyCount: number
    taskCount: number
  } | null
  assignments?: Array<{
    id: number
    title: string
    description: string | null
    dueDate: string
    targetType: "cycle" | "class" | "student"
    taskTypes: string[]
    klpIds: number[]
    scenarioIds: string[]
    klps: Array<{
      id: number
      conceptId: string
      book: string | null
      lesson: string | null
      domain: string
      label: string
      supportStatus: string
    }>
    scenarios: Array<{
      scenarioId: string
      title: string
      description: string
      cefrLevel: string
      status: string
    }>
  }>
  focus: Array<{
    book: string | null
    lesson: string | null
    linkedTasks: number
    practicedConcepts: number
  }>
}

const TASK_LINKS: Record<string, { label: string; href: string }> = {
  "practice-hub": { label: "Practice Hub", href: "/practice/hub" },
  repeat: { label: "Repeat", href: "/practice?stage=repeat" },
  "read-aloud": { label: "Read Aloud", href: "/practice?stage=read-aloud" },
  sentence: { label: "Sentence", href: "/practice?stage=sentence" },
  "free-speak": { label: "Free Speak", href: "/practice?stage=free-speak" },
  scenario: { label: "Scenario", href: "/practice/conversation?mode=scenarios" },
  "ai-conversation": { label: "AI Conversation", href: "/practice/conversation" },
  "weak-words": { label: "Weak Words", href: "/practice/weak-words" },
  fluency: { label: "Fluency Drills", href: "/practice/fluency" },
  "text-practice": { label: "Text Practice", href: "/practice/texts" },
  history: { label: "History", href: "/practice/history" },
  "ai-tutor-insight": { label: "AI Tutor", href: "/practice/hub" },
}

export function KlpFocusWidget({ data }: { data: PracticeData }) {
  const [focus, setFocus] = useState<KlpFocus | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/practice/klp-summary")
      .then((res) => res.ok ? res.json() : null)
      .then((json) => { if (!cancelled) setFocus(json) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!focus?.enabled) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <BookOpen size={19} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Current practice set</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.book?.title ?? "Your active book"} has {data.vocabulary.length} vocabulary items and {data.tasks.length} speaking tasks ready.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const first = focus.focus[0]
  const firstAssignment = focus.assignments?.[0]
  const assignmentConcept = firstAssignment?.klps?.[0]
  const bookLabel = first?.book && first?.lesson
    ? `Book ${first.book} Lesson ${first.lesson}`
    : assignmentConcept?.book && assignmentConcept?.lesson
      ? `Book ${assignmentConcept.book} Lesson ${assignmentConcept.lesson}`
    : focus.activeCycle?.bookTitle ?? data.book?.title ?? "Current lesson"

  return (
    <div className="space-y-4">
      {firstAssignment && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Assigned study plan</p>
              <h3 className="mt-1 font-semibold text-foreground">{firstAssignment.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {firstAssignment.description || `${firstAssignment.klpIds.length} KLP focus item${firstAssignment.klpIds.length === 1 ? "" : "s"} assigned for speaking practice.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {firstAssignment.klps.slice(0, 4).map((klp) => (
                  <span key={klp.id} className="rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground">
                    {klp.label}
                  </span>
                ))}
                {firstAssignment.klps.length > 4 && (
                  <span className="rounded-full bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
                    +{firstAssignment.klps.length - 4} more
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {firstAssignment.taskTypes.map((taskType) => {
                  const link = TASK_LINKS[taskType] ?? { label: taskType, href: "/practice" }
                  return (
                    <Link
                      key={taskType}
                      href={link.href}
                      className="rounded-full border border-emerald-500/30 bg-background/60 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {link.label}
                    </Link>
                  )
                })}
              </div>
            </div>
            <Link
              href={firstAssignment.scenarioIds.length ? "/practice/conversation?mode=scenarios" : "/practice"}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Start assigned work <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-primary/25 bg-primary/10 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20">
              <LibraryBig size={19} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{bookLabel} speaking practice</p>
              <p className="mt-1 text-sm text-muted-foreground">
                These labels connect your speaking work to the lesson plan. Your score is still based on spoken accuracy, fluency, target use, and task completion.
              </p>
            </div>
          </div>
          <Link
            href="/practice"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Practice <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Target size={14} className="text-primary" /> Linked tasks</div>
          <p className="mt-2 text-xl font-bold text-foreground">{first?.linkedTasks ?? focus.activeCycle?.taskCount ?? data.tasks.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 size={14} className="text-emerald-400" /> Practiced KLPs</div>
          <p className="mt-2 text-xl font-bold text-foreground">{first?.practicedConcepts ?? 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen size={14} className="text-blue-400" /> Vocab set</div>
          <p className="mt-2 text-xl font-bold text-foreground">{focus.activeCycle?.vocabularyCount ?? data.vocabulary.length}</p>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  Flag,
  LibraryBig,
  Loader2,
  Mic,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"

interface StudentSummary {
  id: number
  fullName: string
  className: string | null
  cefrBand: string
  hasDiagnostic: boolean
  attemptsInRange: number
  averageScore: number
  averagePronunciation: number
  averageFluency: number
  weakWordCount: number
  needsAttention: boolean
  attentionReasons: string[]
}

interface WeakWordSummary {
  word: string
  count: number
  sources: string[]
}

interface ReportOverview {
  kpis: {
    totalStudents: number
    activeStudents: number
    diagnosticCompletionRate: number
    attemptsInRange: number
    averageScore: number
    passRate: number
    averagePronunciation: number
    averageFluency: number
    weakWordCount: number
    studentsNeedingAttention: number
  }
  students: StudentSummary[]
  topWeakWords: WeakWordSummary[]
  deterministicInsights: string[]
}

interface AiInsight {
  aiAvailable: boolean
  provider?: string
  model?: string
  warning?: string
  headline: string
  insights: string[]
  actions: string[]
}

interface KlpOverview {
  enabled: boolean
  latestSource: { importedAt: string; totalConcepts: number; activeQuestionShapes: number } | null
  totals: {
    totalConcepts: number
    activeQuestionShapes: number
    practicedConcepts: number
    resultEvents: number
    generatedScenarios: number
    publishedScenarios: number
    linkedPracticeTasks: number
  }
  bySupportStatus: Record<string, number>
}

interface SpeechReliabilityReport {
  kpis: {
    sttSuccessRate: number
    azurePronunciationAvailability: number
    failedRecordings: number
    noSpeechAttempts: number
    totalEvents: number
  }
}

interface KlpEvidenceReport {
  totals: {
    assigned: number
    practiced: number
    passed: number
    weak: number
    unattempted: number
    contextOnly: number
  }
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function scoreTone(value: number) {
  if (value >= 0.8) return "text-emerald-400"
  if (value >= 0.65) return "text-amber-400"
  return "text-red-400"
}

function KpiCard({ icon: Icon, label, value, detail, tone = "text-primary" }: {
  icon: React.ElementType
  label: string
  value: string
  detail: string
  tone?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={15} className={tone} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function SkillBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={scoreTone(value)}>{pct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(4, Math.round(value * 100))}%` }}
        />
      </div>
    </div>
  )
}

export default function TeacherDashboardPage() {
  const [data, setData] = useState<ReportOverview | null>(null)
  const [ai, setAi] = useState<AiInsight | null>(null)
  const [klp, setKlp] = useState<KlpOverview | null>(null)
  const [speech, setSpeech] = useState<SpeechReliabilityReport | null>(null)
  const [klpEvidence, setKlpEvidence] = useState<KlpEvidenceReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch("/api/reports/overview")
        const overview = response.ok ? await response.json() : null
        if (!cancelled) setData(overview)
        fetch("/api/admin/klp/overview")
          .then((res) => res.ok ? res.json() : null)
          .then((result) => { if (!cancelled) setKlp(result) })
          .catch(() => {})
        fetch("/api/reports/speech-reliability")
          .then((res) => res.ok ? res.json() : null)
          .then((result) => { if (!cancelled) setSpeech(result) })
          .catch(() => {})
        fetch("/api/reports/klp-evidence")
          .then((res) => res.ok ? res.json() : null)
          .then((result) => { if (!cancelled) setKlpEvidence(result) })
          .catch(() => {})
        if (overview) {
          fetch("/api/reports/ai-insight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "class" }),
          })
            .then((res) => res.json())
            .then((result) => { if (!cancelled) setAi(result) })
            .catch(() => {})
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const attentionStudents = useMemo(
    () => (data?.students ?? []).filter((student) => student.needsAttention).slice(0, 6),
    [data],
  )
  const missingDiagnostics = useMemo(
    () => (data?.students ?? []).filter((student) => !student.hasDiagnostic).slice(0, 5),
    [data],
  )

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-foreground">Teacher Dashboard</h1>
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Could not load teacher reports.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Teacher Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Class progress, review priorities, and next teaching actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teacher/review" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
            <Flag size={15} /> Review queue
          </Link>
          <Link href="/teacher/monitor" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
            <Mic size={15} /> Live monitor
          </Link>
          <Link href="/reports" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Full reports <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Active students" value={`${data.kpis.activeStudents}/${data.kpis.totalStudents}`} detail="Students with recorded practice" />
        <KpiCard icon={BarChart3} label="Attempts" value={String(data.kpis.attemptsInRange)} detail={`${pct(data.kpis.passRate)} pass rate`} tone="text-blue-400" />
        <KpiCard icon={TrendingUp} label="Average score" value={pct(data.kpis.averageScore)} detail="Across selected attempts" tone={scoreTone(data.kpis.averageScore)} />
        <KpiCard icon={AlertTriangle} label="Need attention" value={String(data.kpis.studentsNeedingAttention)} detail="Low score, missing check, or weak words" tone="text-amber-400" />
      </div>

      {speech && speech.kpis.totalEvents > 0 && (speech.kpis.sttSuccessRate < 0.85 || speech.kpis.azurePronunciationAvailability < 0.85 || speech.kpis.noSpeechAttempts > 0) && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-300" />
              <div>
                <h2 className="font-semibold text-foreground">Speech reliability needs attention</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  STT success {pct(speech.kpis.sttSuccessRate)}, Azure pronunciation {pct(speech.kpis.azurePronunciationAvailability)}, no-speech events {speech.kpis.noSpeechAttempts}.
                </p>
              </div>
            </div>
            <Link href="/reports?tab=speech" className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
              Open reliability <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      )}

      {klp?.enabled && (
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <LibraryBig size={20} className="text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">KLP Speaking Coverage</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Curriculum traceability for speaking attempts and scenarios. Grammar/function KLPs guide prompts only and are not reported as mastered.
                </p>
              </div>
            </div>
            <Link href="/reports?tab=klp" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
              View KLP report <ArrowRight size={15} />
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={BookOpen} label="Imported KLPs" value={String(klp.totals.totalConcepts ?? 0)} detail={`${klp.totals.activeQuestionShapes ?? 0} active question shapes`} />
            <KpiCard icon={Target} label="Linked tasks" value={String(klp.totals.linkedPracticeTasks ?? 0)} detail="Vocabulary practice mapped to KLPs" tone="text-blue-400" />
            <KpiCard icon={CheckCircle2} label="Practiced KLPs" value={String(klp.totals.practicedConcepts ?? 0)} detail={`${klp.totals.resultEvents ?? 0} linked results`} tone="text-emerald-400" />
            <KpiCard icon={Sparkles} label="Scenarios" value={`${klp.totals.publishedScenarios ?? 0}/${klp.totals.generatedScenarios ?? 0}`} detail="Published / generated" tone="text-purple-400" />
          </div>
          {klpEvidence && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard icon={Users} label="Assigned KLPs" value={String(klpEvidence.totals.assigned)} detail={`${klpEvidence.totals.unattempted} unattempted`} tone="text-blue-400" />
              <KpiCard icon={CheckCircle2} label="Passed evidence" value={String(klpEvidence.totals.passed)} detail={`${klpEvidence.totals.practiced} practiced`} tone="text-emerald-400" />
              <KpiCard icon={AlertTriangle} label="Weak KLP evidence" value={String(klpEvidence.totals.weak)} detail="Needs targeted review" tone={klpEvidence.totals.weak ? "text-amber-400" : "text-emerald-400"} />
              <KpiCard icon={BookOpen} label="Context-only" value={String(klpEvidence.totals.contextOnly)} detail="Not auto-graded as mastery" tone="text-muted-foreground" />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Class Snapshot</h2>
              <p className="text-xs text-muted-foreground">Skill averages from recent practice</p>
            </div>
            <Link href="/reports" className="text-xs font-medium text-primary hover:underline">Open report</Link>
          </div>
          <div className="space-y-4">
            <SkillBar label="Pronunciation" value={data.kpis.averagePronunciation} />
            <SkillBar label="Fluency" value={data.kpis.averageFluency} />
            <SkillBar label="Overall score" value={data.kpis.averageScore} />
            <SkillBar label="Speaking checks completed" value={data.kpis.diagnosticCompletionRate} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={17} className="text-primary" />
            <div>
              <h2 className="font-semibold text-foreground">AI Teacher Insight</h2>
              <p className="text-xs text-muted-foreground">
                {ai?.aiAvailable ? `${ai.provider} - ${ai.model}` : ai?.warning ? "Fallback insight" : "Loading insight"}
              </p>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{ai?.headline ?? "Reading class progress..."}</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {(ai?.insights ?? data.deterministicInsights).slice(0, 4).map((item, index) => (
              <li key={index} className="flex gap-2">
                <Brain size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-border bg-card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Needs Review</h2>
            <Link href="/reports" className="text-xs font-medium text-primary hover:underline">See all students</Link>
          </div>
          {attentionStudents.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-300">
              <CheckCircle2 size={18} className="mb-2" />
              No urgent review items right now.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {attentionStudents.map((student) => (
                    <tr key={student.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{student.fullName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{student.className ?? "Unassigned"}</td>
                      <td className={`px-4 py-3 font-semibold ${scoreTone(student.averageScore)}`}>{student.attemptsInRange ? pct(student.averageScore) : "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{student.attentionReasons[0]}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/teacher/student/${student.id}`} className="text-xs font-medium text-primary hover:underline">Review</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Class Weak Spots</h2>
          <p className="mt-1 text-xs text-muted-foreground">Most repeated weak words and pronunciation evidence</p>
          <div className="mt-4 space-y-3">
            {data.topWeakWords.slice(0, 6).map((word) => (
              <div key={word.word} className="flex items-center justify-between gap-3 rounded-lg bg-muted/25 px-3 py-2">
                <div>
                  <p className="font-medium text-foreground">{word.word}</p>
                  <p className="text-[11px] text-muted-foreground">{word.sources.join(", ")}</p>
                </div>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{word.count}</span>
              </div>
            ))}
            {data.topWeakWords.length === 0 && (
              <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No weak-word evidence yet.</p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Speaking Check Gaps</h2>
            <p className="text-xs text-muted-foreground">Students who still need the required first sign-in check</p>
          </div>
          <Target size={18} className="text-primary" />
        </div>
        {missingDiagnostics.length === 0 ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            Every visible student has completed the speaking check.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {missingDiagnostics.map((student) => (
              <Link
                key={student.id}
                href={`/teacher/student/${student.id}`}
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/20"
              >
                {student.fullName}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

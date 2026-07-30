"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  Activity,
  BarChart3,
  Brain,
  CheckCircle2,
  FileAudio,
  Filter,
  LibraryBig,
  Loader2,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"

type Tab = "overview" | "class" | "students" | "weak" | "diagnostics" | "audio" | "speech" | "klp"

interface StudentSummary {
  id: number
  fullName: string
  uniqueNumber: string
  className: string | null
  cefrBand: string
  hasDiagnostic: boolean
  attemptsInRange: number
  averageScore: number
  averagePronunciation: number
  averageFluency: number
  averageContent: number
  passRate: number
  masteredWords: number
  weakWordCount: number
  needsAttention: boolean
  attentionReasons: string[]
}

interface ClassSummary {
  className: string
  studentCount: number
  diagnosticCompletionRate: number
  attempts: number
  averageScore: number
  passRate: number
  averagePronunciation: number
  averageFluency: number
  weakWordCount: number
  studentsNeedingAttention: number
}

interface WeakWordSummary {
  word: string
  count: number
  sources: string[]
  students: Array<{ id: number; name: string }>
  averageScore: number | null
}

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

interface ReportOverview {
  generatedAt: string
  kpis: {
    totalStudents: number
    activeStudents: number
    diagnosticCompletionRate: number
    totalAttempts: number
    attemptsInRange: number
    averageScore: number
    passRate: number
    averagePronunciation: number
    averageFluency: number
    averageContent: number
    weakWordCount: number
    audioAttemptCount: number
    studentsNeedingAttention: number
  }
  classes: string[]
  cefrBands: string[]
  students: StudentSummary[]
  classSummaries: ClassSummary[]
  topWeakWords: WeakWordSummary[]
  audioAttempts: AudioAttempt[]
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
  latestSource: { importedAt: string; fileName: string | null; name: string; totalConcepts: number; activeQuestionShapes: number } | null
  warnings: string[]
  totals: {
    totalConcepts: number
    activeQuestionShapes: number
    practicedConcepts: number
    resultEvents: number
    generatedScenarios: number
    publishedScenarios: number
    linkedPracticeTasks: number
    assignedStudyPlans: number
    assignedScenarioPlans: number
  }
  byDomain: Record<string, number>
  bySupportStatus: Record<string, number>
}

interface SpeechReliabilityReport {
  kpis: {
    sttSuccessRate: number
    azurePronunciationAvailability: number
    averageLatencyMs: number
    p95LatencyMs: number
    failedRecordings: number
    noSpeechAttempts: number
    fallbackRate: number
    totalEvents: number
  }
  providerBreakdown: Array<{
    provider: string
    total: number
    successRate: number
    averageLatencyMs: number
    p95LatencyMs: number
    failures: number
    noSpeechAttempts: number
  }>
  classBreakdown: Array<{
    className: string
    total: number
    sttSuccessRate: number
    azurePronunciationAvailability: number
    failedRecordings: number
    noSpeechAttempts: number
    averageLatencyMs: number
  }>
  recentIssues: Array<{
    id: number
    studentName: string | null
    className: string | null
    eventType: string
    provider: string
    route: string
    practiceStage: string | null
    success: boolean
    statusCode: number | null
    errorCode: string | null
    latencyMs: number
    noSpeech: boolean
    fallbackUsed: boolean
    createdAt: string
  }>
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
  items: Array<{
    klpId: number
    conceptId: string
    book: string | null
    lesson: string | null
    domain: string
    label: string
    supportStatus: string
    assignedCount: number
    practicedCount: number
    passedCount: number
    weakCount: number
    unattemptedCount: number
    linkedTaskTypes: string[]
    linkedScenarios: Array<{ scenarioId: string; title: string }>
    latestResultAt: string | null
    latestScorePercent: number | null
  }>
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function tone(value: number) {
  if (value >= 0.8) return "text-emerald-400"
  if (value >= 0.65) return "text-amber-400"
  return "text-red-400"
}

function barColor(value: number) {
  if (value >= 0.8) return "bg-emerald-500"
  if (value >= 0.65) return "bg-amber-500"
  return "bg-red-500"
}

function MetricCard({ label, value, detail, icon: Icon, color = "text-primary" }: {
  label: string
  value: string
  detail: string
  icon: React.ElementType
  color?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon size={16} className={color} />
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${Math.max(4, Math.round(value * 100))}%` }} />
      </div>
      <span className={`w-10 text-right text-xs font-semibold ${tone(value)}`}>{pct(value)}</span>
    </div>
  )
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportOverview | null>(null)
  const [ai, setAi] = useState<AiInsight | null>(null)
  const [klp, setKlp] = useState<KlpOverview | null>(null)
  const [speech, setSpeech] = useState<SpeechReliabilityReport | null>(null)
  const [klpEvidence, setKlpEvidence] = useState<KlpEvidenceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("overview")
  const [className, setClassName] = useState("")
  const [cefr, setCefr] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab")
    if (requested === "klp") setTab("klp")
    if (requested === "speech") setTab("speech")
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const params = new URLSearchParams()
      if (className) params.set("class", className)
      if (cefr) params.set("cefr", cefr)
      try {
        const res = await fetch(`/api/reports/overview?${params.toString()}`)
        const json = res.ok ? await res.json() : null
        if (!cancelled) setData(json)
        fetch("/api/admin/klp/overview")
          .then((r) => r.ok ? r.json() : null)
          .then((result) => { if (!cancelled) setKlp(result) })
          .catch(() => {})
        fetch(`/api/reports/speech-reliability?${params.toString()}`)
          .then((r) => r.ok ? r.json() : null)
          .then((result) => { if (!cancelled) setSpeech(result) })
          .catch(() => {})
        fetch(`/api/reports/klp-evidence?${params.toString()}`)
          .then((r) => r.ok ? r.json() : null)
          .then((result) => { if (!cancelled) setKlpEvidence(result) })
          .catch(() => {})
        if (json) {
          fetch("/api/reports/ai-insight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "class", className: className || null, cefr: cefr || null }),
          })
            .then((r) => r.json())
            .then((insight) => { if (!cancelled) setAi(insight) })
            .catch(() => {})
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [className, cefr])

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data?.students ?? []
    return (data?.students ?? []).filter((student) =>
      student.fullName.toLowerCase().includes(q) ||
      student.uniqueNumber.toLowerCase().includes(q) ||
      (student.className ?? "").toLowerCase().includes(q),
    )
  }, [data, query])

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Reports are unavailable for this account.
        </div>
      </div>
    )
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "class", label: "Class Performance" },
    { id: "students", label: "Student Progress" },
    { id: "weak", label: "Weak Words" },
    { id: "diagnostics", label: "Diagnostics" },
    { id: "audio", label: "Audio Attempts" },
    { id: "speech", label: "Speech Reliability" },
    { id: "klp", label: "KLP Coverage" },
  ]

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Learning Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visual class reports for progress, weak words, diagnostics, and audio review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Filter size={14} className="text-muted-foreground" />
            <select value={className} onChange={(e) => setClassName(e.target.value)} className="bg-transparent text-sm text-foreground outline-none">
              <option value="">All classes</option>
              {data.classes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <select value={cefr} onChange={(e) => setCefr(e.target.value)} className="bg-transparent text-sm text-foreground outline-none">
              <option value="">All CEFR</option>
              {data.cefrBands.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find student..." className="w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition ${tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Students" value={`${data.kpis.activeStudents}/${data.kpis.totalStudents}`} detail="Have practice data" icon={Users} />
            <MetricCard label="Average score" value={pct(data.kpis.averageScore)} detail={`${pct(data.kpis.passRate)} pass rate`} icon={TrendingUp} color={tone(data.kpis.averageScore)} />
            <MetricCard label="Diagnostics" value={pct(data.kpis.diagnosticCompletionRate)} detail="Completed speaking check" icon={CheckCircle2} color="text-emerald-400" />
            <MetricCard label="Needs attention" value={String(data.kpis.studentsNeedingAttention)} detail="Review priority students" icon={AlertTriangle} color="text-amber-400" />
          </div>

          {klp?.enabled && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="KLP concepts" value={String(klp.totals.totalConcepts ?? 0)} detail="Imported curriculum records" icon={LibraryBig} />
              <MetricCard label="Linked tasks" value={String(klp.totals.linkedPracticeTasks ?? 0)} detail="Practice tasks tied to KLPs" icon={Target} />
              <MetricCard label="Practiced KLPs" value={String(klp.totals.practicedConcepts ?? 0)} detail={`${klp.totals.resultEvents ?? 0} result events`} icon={CheckCircle2} color="text-emerald-400" />
              <MetricCard label="KLP scenarios" value={`${klp.totals.publishedScenarios ?? 0}/${klp.totals.generatedScenarios ?? 0}`} detail="Published / generated" icon={Sparkles} color="text-blue-400" />
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <section className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles size={17} className="text-primary" />
                <div>
                  <h2 className="font-semibold text-foreground">AI Teacher Insight</h2>
                  <p className="text-xs text-muted-foreground">{ai?.aiAvailable ? `${ai.provider} - ${ai.model}` : "Falls back to measured data"}</p>
                </div>
              </div>
              <h3 className="text-sm font-semibold text-foreground">{ai?.headline ?? "Class insight"}</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {(ai?.insights ?? data.deterministicInsights).slice(0, 5).map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <Brain size={14} className="mt-0.5 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">Skill Breakdown</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Pronunciation</p>
                  <ScoreBar value={data.kpis.averagePronunciation} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Fluency</p>
                  <ScoreBar value={data.kpis.averageFluency} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Content</p>
                  <ScoreBar value={data.kpis.averageContent} />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Overall</p>
                  <ScoreBar value={data.kpis.averageScore} />
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === "class" && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.classSummaries.map((cls) => (
            <section key={cls.className} className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-foreground">{cls.className}</h2>
                  <p className="text-xs text-muted-foreground">{cls.studentCount} students - {cls.attempts} attempts</p>
                </div>
                <span className={`text-lg font-bold ${tone(cls.averageScore)}`}>{pct(cls.averageScore)}</span>
              </div>
              <div className="space-y-3">
                <ScoreBar value={cls.averagePronunciation} />
                <ScoreBar value={cls.averageFluency} />
                <div className="flex items-center justify-between rounded-lg bg-muted/25 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Need attention</span>
                  <span className="font-semibold text-foreground">{cls.studentsNeedingAttention}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/25 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Weak-word signals</span>
                  <span className="font-semibold text-foreground">{cls.weakWordCount}</span>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "students" && (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">CEFR</th>
                <th className="px-4 py-3">Overall</th>
                <th className="px-4 py-3">Pronunciation</th>
                <th className="px-4 py-3">Fluency</th>
                <th className="px-4 py-3">Weak Words</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student) => (
                <tr key={student.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{student.fullName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{student.className ?? "Unassigned"}</td>
                  <td className="px-4 py-3"><span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{student.cefrBand}</span></td>
                  <td className="px-4 py-3"><ScoreBar value={student.averageScore} /></td>
                  <td className="px-4 py-3"><ScoreBar value={student.averagePronunciation} /></td>
                  <td className="px-4 py-3"><ScoreBar value={student.averageFluency} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{student.weakWordCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/teacher/student/${student.id}`} className="text-xs font-medium text-primary hover:underline">Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "weak" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.topWeakWords.map((word) => (
            <section key={word.word} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{word.word}</h2>
                  <p className="text-xs text-muted-foreground">{word.sources.join(", ")}</p>
                </div>
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">{word.count} signals</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Students: {word.students.slice(0, 4).map((student) => student.name).join(", ") || "No students"}</p>
              {word.averageScore !== null && <div className="mt-3"><ScoreBar value={word.averageScore} /></div>}
            </section>
          ))}
          {data.topWeakWords.length === 0 && <p className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">No weak-word signals yet.</p>}
        </div>
      )}

      {tab === "diagnostics" && (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Diagnostic Completion</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {filteredStudents.map((student) => (
              <div key={student.id} className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3">
                <div>
                  <p className="font-medium text-foreground">{student.fullName}</p>
                  <p className="text-xs text-muted-foreground">{student.className ?? "Unassigned"} - {student.cefrBand}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${student.hasDiagnostic ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {student.hasDiagnostic ? "Completed" : "Required"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "audio" && (
        <section className="space-y-3">
          {data.audioAttempts.map((attempt) => (
            <div key={attempt.id} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{attempt.studentName}</p>
                  <p className="text-xs text-muted-foreground">{new Date(attempt.timestamp).toLocaleString()} - {attempt.taskType ?? "Task"} - {attempt.word ?? "No word"}</p>
                  {attempt.transcript && <p className="mt-2 text-sm italic text-muted-foreground">&quot;{attempt.transcript}&quot;</p>}
                </div>
                <div className={`text-sm font-bold ${tone(attempt.score)}`}>{pct(attempt.score)}</div>
              </div>
              <audio controls className="w-full">
                <source src={`/api/attempts/${attempt.id}/audio`} />
              </audio>
            </div>
          ))}
          {data.audioAttempts.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
              <FileAudio size={36} className="mx-auto mb-3" />
              No audio attempts match these filters.
            </div>
          )}
        </section>
      )}

      {tab === "speech" && (
        <div className="space-y-5">
          {!speech ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
              Speech reliability data is not available yet.
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="STT success" value={pct(speech.kpis.sttSuccessRate)} detail={`${speech.kpis.totalEvents} speech events`} icon={Activity} color={tone(speech.kpis.sttSuccessRate || 1)} />
                <MetricCard label="Azure pronunciation" value={pct(speech.kpis.azurePronunciationAvailability)} detail="Availability when attempted" icon={CheckCircle2} color={tone(speech.kpis.azurePronunciationAvailability || 1)} />
                <MetricCard label="Latency p95" value={`${speech.kpis.p95LatencyMs}ms`} detail={`${speech.kpis.averageLatencyMs}ms average`} icon={TrendingUp} color="text-blue-400" />
                <MetricCard label="No speech" value={String(speech.kpis.noSpeechAttempts)} detail={`${speech.kpis.failedRecordings} failed recordings`} icon={AlertTriangle} color={speech.kpis.noSpeechAttempts ? "text-amber-400" : "text-emerald-400"} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                <section className="rounded-lg border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Provider Breakdown</h2>
                  <div className="mt-4 space-y-3">
                    {speech.providerBreakdown.map((provider) => (
                      <div key={provider.provider} className="rounded-lg border border-border bg-background/45 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">{provider.provider}</p>
                          <span className={`text-sm font-semibold ${tone(provider.successRate || 1)}`}>{pct(provider.successRate)}</span>
                        </div>
                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                          <span>{provider.total} events</span>
                          <span>{provider.p95LatencyMs}ms p95</span>
                          <span>{provider.noSpeechAttempts} no-speech</span>
                        </div>
                      </div>
                    ))}
                    {speech.providerBreakdown.length === 0 && <p className="text-sm text-muted-foreground">No provider events recorded yet.</p>}
                  </div>
                </section>

                <section className="rounded-lg border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Class Impact</h2>
                  <div className="mt-4 space-y-3">
                    {speech.classBreakdown.slice(0, 8).map((cls) => (
                      <div key={cls.className} className="rounded-lg border border-border bg-background/45 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="font-medium text-foreground">{cls.className}</p>
                          <span className="text-xs text-muted-foreground">{cls.total} events</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">STT success</p>
                            <ScoreBar value={cls.sttSuccessRate} />
                          </div>
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">Azure pronunciation</p>
                            <ScoreBar value={cls.azurePronunciationAvailability} />
                          </div>
                        </div>
                      </div>
                    ))}
                    {speech.classBreakdown.length === 0 && <p className="text-sm text-muted-foreground">No class-level events recorded yet.</p>}
                  </div>
                </section>
              </div>

              <section className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold text-foreground">Recent Reliability Issues</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Sanitized operational events only. No audio or transcript is shown here.</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Issue</th>
                      <th className="px-4 py-3">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {speech.recentIssues.map((issue) => (
                      <tr key={issue.id} className="border-t border-border">
                        <td className="px-4 py-3 text-muted-foreground">{new Date(issue.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-foreground">{issue.studentName ?? issue.className ?? "Unknown"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{issue.provider}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                            {issue.noSpeech ? "no speech" : issue.errorCode ?? "failed"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{issue.latencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {speech.recentIssues.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No reliability issues recorded in this range.</p>}
              </section>
            </>
          )}
        </div>
      )}

      {tab === "klp" && (
        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <LibraryBig size={18} className="text-primary" />
              <h2 className="font-semibold text-foreground">KLP Speaking Coverage</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              KLP results track speaking-performance evidence only: pronunciation, fluency, target use, completeness, consistency, and scenario interaction success.
            </p>
            {!klp?.enabled ? (
              <div className="mt-4 rounded-lg border border-border bg-background/50 p-5 text-sm text-muted-foreground">
                KLP features are currently disabled by admin.
              </div>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <MetricCard label="Imported concepts" value={String(klp.totals.totalConcepts ?? 0)} detail={`${klp.totals.activeQuestionShapes ?? 0} question shapes`} icon={LibraryBig} />
                <MetricCard label="Linked practice tasks" value={String(klp.totals.linkedPracticeTasks ?? 0)} detail="Vocabulary mappings" icon={Target} />
                <MetricCard label="Practiced KLPs" value={String(klp.totals.practicedConcepts ?? 0)} detail="Have at least one result" icon={CheckCircle2} color="text-emerald-400" />
                <MetricCard label="Generated scenarios" value={String(klp.totals.generatedScenarios ?? 0)} detail={`${klp.totals.publishedScenarios ?? 0} published`} icon={Sparkles} color="text-blue-400" />
                <MetricCard label="Assigned study plans" value={String(klp.totals.assignedStudyPlans ?? 0)} detail={`${klp.totals.assignedScenarioPlans ?? 0} include scenarios`} icon={Users} color="text-emerald-400" />
                {klpEvidence && (
                  <>
                    <MetricCard label="Assigned evidence" value={String(klpEvidence.totals.assigned)} detail={`${klpEvidence.totals.unattempted} unattempted`} icon={Users} color="text-blue-400" />
                    <MetricCard label="Weak KLPs" value={String(klpEvidence.totals.weak)} detail={`${klpEvidence.totals.passed} passed`} icon={AlertTriangle} color={klpEvidence.totals.weak ? "text-amber-400" : "text-emerald-400"} />
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {klpEvidence && (
              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="font-semibold text-foreground">Teacher Evidence</h2>
                <p className="mt-1 text-sm text-muted-foreground">Assigned, practiced, passed, weak, and unattempted KLP-linked speaking work.</p>
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">KLP</th>
                        <th className="px-3 py-2">Book/Lesson</th>
                        <th className="px-3 py-2">Assigned</th>
                        <th className="px-3 py-2">Practiced</th>
                        <th className="px-3 py-2">Passed</th>
                        <th className="px-3 py-2">Weak</th>
                        <th className="px-3 py-2">Unattempted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {klpEvidence.items.slice(0, 20).map((item) => (
                        <tr key={item.klpId} className="border-t border-border">
                          <td className="px-3 py-2">
                            <p className="font-medium text-foreground">{item.conceptId}</p>
                            <p className="line-clamp-1 text-xs text-muted-foreground">{item.label}</p>
                            {item.supportStatus === "prompt_context_only" && <span className="mt-1 inline-block rounded bg-blue-500/15 px-1.5 py-0.5 text-[0.65rem] text-blue-300">context only</span>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{item.book ?? "-"} / {item.lesson ?? "-"}</td>
                          <td className="px-3 py-2 text-foreground">{item.assignedCount}</td>
                          <td className="px-3 py-2 text-foreground">{item.practicedCount}</td>
                          <td className="px-3 py-2 text-emerald-300">{item.passedCount}</td>
                          <td className="px-3 py-2 text-amber-300">{item.weakCount}</td>
                          <td className="px-3 py-2 text-red-300">{item.unattemptedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {klpEvidence.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No KLP evidence matches these filters yet.</p>}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">Support Status</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(klp?.bySupportStatus ?? {}).map(([status, count]) => (
                  <div key={status} className="rounded-lg border border-border bg-background/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {status === "speaking_scored" ? "Speaking scored" : status === "prompt_context_only" ? "Prompt context only" : "Unsupported"}
                      </p>
                      <span className="text-lg font-bold text-foreground">{count}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {status === "speaking_scored"
                        ? "Can receive pass/fail evidence from speaking tasks."
                        : status === "prompt_context_only"
                          ? "Used to shape prompts and scenarios, exported as unassessed."
                          : "Stored for catalog visibility only."}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">Domain Mix</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(klp?.byDomain ?? {}).map(([domainName, count]) => (
                  <div key={domainName}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-muted-foreground">{domainName}</span>
                      <span className="font-semibold text-foreground">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (count / Math.max(1, klp?.totals.totalConcepts ?? 1)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      )}
    </div>
  )
}

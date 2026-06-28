"use client"

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react"
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Target,
  ToggleLeft,
  ToggleRight,
  Users,
} from "lucide-react"

type Tab = "import" | "browse" | "coverage" | "scenarios" | "export"

interface KlpOverview {
  enabled: boolean
  latestSource: {
    id: number
    name: string
    fileName: string | null
    importedAt: string
    totalConcepts: number
    activeQuestionShapes: number
  } | null
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

interface KlpConcept {
  id: number
  conceptId: string
  book: string | null
  lesson: string | null
  domain: string
  baseItem: string | null
  subtype: string | null
  definition: string | null
  dliClassification: string | null
  primarySkillType: string | null
  secondarySkillType: string | null
  supportStatus: string
  activeQuestionCount: number
  activeQuestionShapes: string[]
}

interface ConceptResponse {
  rows: KlpConcept[]
  count: number
  limit: number
  offset: number
}

interface GeneratedScenario {
  id: number
  scenarioId: string
  title: string
  description: string
  cefrLevel: string
  aiRole: string
  studentGoal: string
  firstMessage: string
  status: "draft" | "published"
  source: string
  targetVocabulary: string[]
  successCriteria: string[]
  klpIds: number[]
}

interface CycleOption {
  id: number
  startDate: string
  endDate: string
  enrollmentCount: number
  book?: { title?: string | null; cefrLevel?: string | null } | null
}

interface StudentOption {
  id: number
  fullName: string
  uniqueNumber: string
  class: string | null
}

interface ImportSummary {
  conceptsTotal: number
  activeQuestionShapesTotal: number
  byDomain: Record<string, number>
  bySupportStatus: Record<string, number>
  unmatchedActiveQuestionIds: string[]
}

interface ImportPreview {
  summary?: ImportSummary
  parsed?: ImportSummary
  warnings?: string[]
  linkedTaskCount?: number
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "import", label: "Import" },
  { id: "browse", label: "Browse KLPs" },
  { id: "coverage", label: "Coverage" },
  { id: "scenarios", label: "Generated Scenarios" },
  { id: "export", label: "Export Preview" },
]

function number(value: unknown) {
  return Number(value ?? 0).toLocaleString()
}

function statusLabel(status: string) {
  if (status === "speaking_scored") return "Speaking scored"
  if (status === "prompt_context_only") return "Prompt context only"
  return "Unsupported"
}

function statusClass(status: string) {
  if (status === "speaking_scored") return "bg-emerald-500/15 text-emerald-300"
  if (status === "prompt_context_only") return "bg-blue-500/15 text-blue-300"
  return "bg-muted text-muted-foreground"
}

function defaultDueDate() {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().slice(0, 10)
}

function MetricCard({ label, value, detail, icon: Icon }: {
  label: string
  value: string
  detail: string
  icon: React.ElementType
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon size={16} className="text-primary" />
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

export default function AdminCurriculumPage() {
  const [tab, setTab] = useState<Tab>("import")
  const [overview, setOverview] = useState<KlpOverview | null>(null)
  const [concepts, setConcepts] = useState<ConceptResponse | null>(null)
  const [scenarios, setScenarios] = useState<GeneratedScenario[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [book, setBook] = useState("")
  const [lesson, setLesson] = useState("")
  const [domain, setDomain] = useState("")
  const [supportStatus, setSupportStatus] = useState("")
  const [cefr, setCefr] = useState("A1")
  const [progressionMode, setProgressionMode] = useState("guided")
  const [cycles, setCycles] = useState<CycleOption[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [assignScenarioId, setAssignScenarioId] = useState("")
  const [assignTargetType, setAssignTargetType] = useState<"cycle" | "class" | "student">("cycle")
  const [assignCycleId, setAssignCycleId] = useState("")
  const [assignClassName, setAssignClassName] = useState("")
  const [assignStudentIds, setAssignStudentIds] = useState<number[]>([])
  const [assignDueDate, setAssignDueDate] = useState(defaultDueDate())
  const [assignTaskTypes, setAssignTaskTypes] = useState<string[]>(["scenario"])

  const selectedConcepts = useMemo(
    () => (concepts?.rows ?? []).filter((concept) => selected.includes(concept.id)),
    [concepts, selected],
  )
  const assignmentScenario = useMemo(
    () => scenarios.find((scenario) => scenario.scenarioId === assignScenarioId) ?? null,
    [scenarios, assignScenarioId],
  )
  const assignmentKlpIds = useMemo(
    () => assignmentScenario?.klpIds ?? selected,
    [assignmentScenario, selected],
  )

  async function loadOverview() {
    const res = await fetch("/api/admin/klp/overview")
    if (res.ok) setOverview(await res.json())
  }

  async function loadConcepts() {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (book) params.set("book", book)
    if (lesson) params.set("lesson", lesson)
    if (domain) params.set("domain", domain)
    if (supportStatus) params.set("supportStatus", supportStatus)
    params.set("limit", "80")
    const res = await fetch(`/api/admin/klp/concepts?${params.toString()}`)
    if (res.ok) setConcepts(await res.json())
  }

  async function loadScenarios() {
    const res = await fetch("/api/admin/klp/scenarios")
    if (res.ok) {
      const json = await res.json()
      setScenarios(json.scenarios ?? [])
    }
  }

  async function loadAssignmentTargets() {
    const [cycleRes, classRes, studentRes] = await Promise.all([
      fetch("/api/cycles"),
      fetch("/api/admin/classes"),
      fetch("/api/students"),
    ])
    if (cycleRes.ok) {
      const json = await cycleRes.json()
      const rows = (json.cycles ?? []) as CycleOption[]
      setCycles(rows)
      if (!assignCycleId && rows[0]) setAssignCycleId(String(rows[0].id))
    }
    if (classRes.ok) {
      const json = await classRes.json()
      const rows = (json.classes ?? []) as string[]
      setClasses(rows)
      if (!assignClassName && rows[0]) setAssignClassName(rows[0])
    }
    if (studentRes.ok) {
      const json = await studentRes.json()
      setStudents((json.students ?? []) as StudentOption[])
    }
  }

  useEffect(() => {
    loadOverview().catch(() => {})
    loadScenarios().catch(() => {})
    loadAssignmentTargets().catch(() => {})
  }, [])

  useEffect(() => {
    loadConcepts().catch(() => {})
  }, [q, book, lesson, domain, supportStatus])

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setPreview(null)
    setMessage(null)
    setSelectedFile(event.target.files?.[0] ?? null)
  }

  async function submitWorkbook(commit: boolean) {
    if (!selectedFile) return
    setBusy(true)
    setMessage(null)
    try {
      const body = new FormData()
      body.set("file", selectedFile)
      body.set("name", "ALC KLP Index")
      const res = await fetch(`/api/admin/klp/import?commit=${commit ? "true" : "false"}`, {
        method: "POST",
        body,
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage(json.error ?? "KLP import failed.")
        return
      }
      setPreview(json)
      setMessage(commit ? "Workbook imported and KLP features are enabled." : "Workbook validation completed.")
      if (commit) {
        await loadOverview()
        await loadConcepts()
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggleKlp(enabled: boolean) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/klp/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) setOverview(await res.json())
    } finally {
      setBusy(false)
    }
  }

  async function generateScenario(event: FormEvent) {
    event.preventDefault()
    if (selected.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/klp/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ klpIds: selected, cefrLevel: cefr, progressionMode }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage(json.error ?? "Scenario generation failed.")
        return
      }
      setMessage("Draft scenario generated. Review it before publishing.")
      await loadScenarios()
    } finally {
      setBusy(false)
    }
  }

  async function publishScenario(id: number, publish: boolean) {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/klp/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", id, publish }),
      })
      if (res.ok) await loadScenarios()
    } finally {
      setBusy(false)
    }
  }

  function toggleTaskType(taskType: string) {
    setAssignTaskTypes((current) =>
      current.includes(taskType)
        ? current.filter((item) => item !== taskType)
        : [...current, taskType],
    )
  }

  async function assignKlpWork(event: FormEvent) {
    event.preventDefault()
    if (!assignCycleId || !assignDueDate || assignmentKlpIds.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const title = assignmentScenario
        ? `KLP scenario: ${assignmentScenario.title}`
        : `KLP speaking practice (${assignmentKlpIds.length} item${assignmentKlpIds.length === 1 ? "" : "s"})`
      const res = await fetch("/api/admin/klp/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId: Number(assignCycleId),
          title,
          description: assignmentScenario?.description ?? "Teacher-assigned KLP speaking practice.",
          dueDate: assignDueDate,
          targetType: assignTargetType,
          className: assignTargetType === "class" ? assignClassName : undefined,
          studentIds: assignTargetType === "student" ? assignStudentIds : [],
          klpIds: assignmentKlpIds,
          scenarioIds: assignmentScenario ? [assignmentScenario.scenarioId] : [],
          taskTypes: assignTaskTypes.length ? assignTaskTypes : ["scenario"],
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(json?.error ?? "Assignment failed.")
        return
      }
      setMessage("KLP study-plan assignment created.")
      setAssignStudentIds([])
    } finally {
      setBusy(false)
    }
  }

  const summary = preview?.summary ?? preview?.parsed

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Curriculum KLPs</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Import ALC/KLP curriculum data for speaking traceability, scenario generation, reports, and JSON export. Grammar and function KLPs are prompt context only.
          </p>
        </div>
        <button
          onClick={() => toggleKlp(!overview?.enabled)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
        >
          {overview?.enabled ? <ToggleRight size={18} className="text-emerald-400" /> : <ToggleLeft size={18} />}
          KLP features {overview?.enabled ? "enabled" : "disabled"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="KLP concepts" value={number(overview?.totals.totalConcepts)} detail="Exact imported concept records" icon={Database} />
        <MetricCard label="Active question shapes" value={number(overview?.totals.activeQuestionShapes)} detail="Imported as traceability metadata" icon={FileSpreadsheet} />
        <MetricCard label="Linked practice tasks" value={number(overview?.totals.linkedPracticeTasks)} detail="Vocabulary tasks mapped to KLPs" icon={BookOpen} />
        <MetricCard label="Published scenarios" value={`${number(overview?.totals.publishedScenarios)}/${number(overview?.totals.generatedScenarios)}`} detail="Reviewed KLP role-plays" icon={Sparkles} />
      </div>

      {message && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {message}
        </div>
      )}

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

      {tab === "import" && (
        <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Import ALC Workbook</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload the workbook, validate counts and warnings, then commit. Existing scoring behavior is unchanged.
            </p>
            <input
              type="file"
              accept=".xlsx"
              onChange={onFileChange}
              className="mt-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                disabled={!selectedFile || busy}
                onClick={() => submitWorkbook(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Validate
              </button>
              <button
                disabled={!selectedFile || busy}
                onClick={() => submitWorkbook(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <CheckCircle2 size={15} />
                Commit import
              </button>
            </div>
            {overview?.latestSource && (
              <div className="mt-5 rounded-lg border border-border bg-background/50 p-4 text-sm">
                <p className="font-medium text-foreground">Current source</p>
                <p className="mt-1 text-muted-foreground">{overview.latestSource.fileName ?? overview.latestSource.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">Imported {new Date(overview.latestSource.importedAt).toLocaleString()}</p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Validation Result</h2>
            {summary ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Concepts" value={number(summary.conceptsTotal)} detail="Expected 7,420" icon={Database} />
                  <MetricCard label="Question shapes" value={number(summary.activeQuestionShapesTotal)} detail="Expected 4,268" icon={FileSpreadsheet} />
                  <MetricCard label="Warnings" value={number((preview?.warnings ?? []).length)} detail="Warnings do not block import" icon={AlertTriangle} />
                </div>
                <div className="rounded-lg border border-border bg-background/50 p-4">
                  <p className="text-sm font-medium text-foreground">Support status</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(summary.bySupportStatus).map(([key, value]) => (
                      <span key={key} className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(key)}`}>
                        {statusLabel(key)}: {number(value)}
                      </span>
                    ))}
                  </div>
                </div>
                {(preview?.warnings ?? []).length > 0 && (
                  <div className="max-h-56 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="mb-2 text-sm font-semibold text-amber-300">Import warnings</p>
                    <ul className="space-y-1 text-xs text-amber-100/90">
                      {(preview?.warnings ?? []).slice(0, 60).map((warning, index) => <li key={index}>{warning}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-border bg-background/50 p-8 text-center text-sm text-muted-foreground">
                Choose the ALC/KLP workbook and run validation.
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "browse" && (
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-5">
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 md:col-span-2">
                <Search size={15} className="text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ConceptID, word, definition" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
              </label>
              <input value={book} onChange={(e) => setBook(e.target.value)} placeholder="Book" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none" />
              <input value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="Lesson" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none" />
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none">
                <option value="">All domains</option>
                <option value="Vocabulary">Vocabulary</option>
                <option value="Grammar">Grammar</option>
                <option value="Functions">Functions</option>
                <option value="Skills">Skills</option>
              </select>
              <select value={supportStatus} onChange={(e) => setSupportStatus(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none">
                <option value="">All support</option>
                <option value="speaking_scored">Speaking scored</option>
                <option value="prompt_context_only">Prompt context only</option>
                <option value="unsupported">Unsupported</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Filter size={15} />
                {number(concepts?.count)} matching KLPs
              </div>
              <p className="text-xs text-muted-foreground">{selected.length} selected for scenario generation</p>
            </div>
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-3"></th>
                    <th className="px-4 py-3">ConceptID</th>
                    <th className="px-4 py-3">Book/Lesson</th>
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Support</th>
                    <th className="px-4 py-3">Question Shapes</th>
                  </tr>
                </thead>
                <tbody>
                  {(concepts?.rows ?? []).map((concept) => (
                    <tr key={concept.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(concept.id)}
                          onChange={(e) => setSelected((current) => e.target.checked ? [...current, concept.id] : current.filter((id) => id !== concept.id))}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{concept.conceptId}</td>
                      <td className="px-4 py-3 text-muted-foreground">B{concept.book ?? "-"} L{concept.lesson ?? "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{concept.domain}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{concept.subtype || concept.baseItem || concept.definition || "Untitled KLP"}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{concept.definition}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(concept.supportStatus)}`}>{statusLabel(concept.supportStatus)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{concept.activeQuestionShapes.slice(0, 3).join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === "coverage" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Domain Coverage</h2>
            <div className="mt-4 space-y-3">
              {Object.entries(overview?.byDomain ?? {}).map(([key, value]) => (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="font-semibold text-foreground">{number(value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (value / Math.max(1, Number(overview?.totals.totalConcepts ?? 1))) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Assessment Support</h2>
            <div className="mt-4 space-y-3">
              {Object.entries(overview?.bySupportStatus ?? {}).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border bg-background/50 p-4">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(key)}`}>{statusLabel(key)}</span>
                  <p className="mt-2 text-2xl font-bold text-foreground">{number(value)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key === "speaking_scored" ? "Can be tied to speaking attempts." : key === "prompt_context_only" ? "Used in prompts, not auto-assessed." : "Visible in catalog, not generated."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "scenarios" && (
        <section className="space-y-4">
          <form onSubmit={generateScenario} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Generate KLP Scenario Draft</h2>
                <p className="mt-1 text-sm text-muted-foreground">Use selected KLPs as context. Publish only after teacher/admin review.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={cefr} onChange={(e) => setCefr(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none">
                  {["A1", "A2", "B1", "B2", "C1"].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                <select value={progressionMode} onChange={(e) => setProgressionMode(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none">
                  <option value="controlled">Controlled</option>
                  <option value="guided">Guided</option>
                  <option value="open">Open</option>
                  <option value="simulation">Exam/workplace</option>
                </select>
                <button disabled={busy || selected.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Generate draft
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedConcepts.slice(0, 10).map((concept) => (
                <span key={concept.id} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">{concept.conceptId}</span>
              ))}
              {selected.length > selectedConcepts.length && <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{selected.length - selectedConcepts.length} selected outside current filter</span>}
            </div>
          </form>

          <form onSubmit={assignKlpWork} className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Users size={17} className="text-primary" />
                  <h2 className="font-semibold text-foreground">Assign KLP Study Plan</h2>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Assign a published KLP scenario or the selected KLPs to a cycle/cohort, class, or individual students. This appears in the student Practice Hub and scenario list.
                </p>
              </div>
              <button
                disabled={busy || !assignCycleId || !assignDueDate || assignmentKlpIds.length === 0 || (assignTargetType === "student" && assignStudentIds.length === 0) || (assignTargetType === "class" && !assignClassName)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Target size={15} />}
                Assign
              </button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Scenario</span>
                <select
                  value={assignScenarioId}
                  onChange={(event) => setAssignScenarioId(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="">Selected KLPs only</option>
                  {scenarios.filter((scenario) => scenario.status === "published").map((scenario) => (
                    <option key={scenario.scenarioId} value={scenario.scenarioId}>{scenario.title}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Cycle / cohort</span>
                <select
                  value={assignCycleId}
                  onChange={(event) => setAssignCycleId(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                >
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.book?.title ?? `Cycle ${cycle.id}`} · {cycle.enrollmentCount} students
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Due date</span>
                <input
                  type="date"
                  value={assignDueDate}
                  onChange={(event) => setAssignDueDate(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Target</span>
                <select
                  value={assignTargetType}
                  onChange={(event) => setAssignTargetType(event.target.value as "cycle" | "class" | "student")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                >
                  <option value="cycle">Whole cycle / cohort</option>
                  <option value="class">Class</option>
                  <option value="student">Selected students</option>
                </select>
              </label>

              {assignTargetType === "class" && (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Class</span>
                  <select
                    value={assignClassName}
                    onChange={(event) => setAssignClassName(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                  >
                    {classes.map((className) => <option key={className} value={className}>{className}</option>)}
                  </select>
                </label>
              )}

              {assignTargetType === "student" && (
                <label className="space-y-1 lg:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Students</span>
                  <select
                    multiple
                    value={assignStudentIds.map(String)}
                    onChange={(event) => setAssignStudentIds(Array.from(event.currentTarget.selectedOptions).map((option) => Number(option.value)))}
                    className="h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
                  >
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.fullName} · {student.class ?? "Unassigned"} · {student.uniqueNumber}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-border bg-background/50 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <CalendarDays size={14} />
                Practice modes
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["repeat", "Repeat"],
                  ["read-aloud", "Read Aloud"],
                  ["sentence", "Sentence"],
                  ["free-speak", "Free Speak"],
                  ["scenario", "Scenario"],
                  ["weak-words", "Weak Words"],
                  ["fluency", "Fluency Drills"],
                ].map(([value, label]) => (
                  <label key={value} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${assignTaskTypes.includes(value) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                    <input
                      type="checkbox"
                      checked={assignTaskTypes.includes(value)}
                      onChange={() => toggleTaskType(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Assignment will include {assignmentKlpIds.length} KLP link{assignmentKlpIds.length === 1 ? "" : "s"}
                {assignmentScenario ? ` and scenario "${assignmentScenario.title}".` : "."}
              </p>
            </div>
          </form>

          <div className="grid gap-4 xl:grid-cols-2">
            {scenarios.map((scenario) => (
              <article key={scenario.id} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-foreground">{scenario.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{scenario.description}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scenario.status === "published" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {scenario.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/25 p-3">
                    <p className="text-xs font-semibold text-muted-foreground">AI role</p>
                    <p className="mt-1 text-sm text-foreground">{scenario.aiRole}</p>
                  </div>
                  <div className="rounded-lg bg-muted/25 p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Student goal</p>
                    <p className="mt-1 text-sm text-foreground">{scenario.studentGoal}</p>
                  </div>
                </div>
                <p className="mt-3 rounded-lg border border-border bg-background/50 p-3 text-sm text-muted-foreground">&quot;{scenario.firstMessage}&quot;</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {scenario.targetVocabulary.slice(0, 6).map((word) => <span key={word} className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-300">{word}</span>)}
                </div>
                <button
                  disabled={busy}
                  onClick={() => publishScenario(scenario.id, scenario.status !== "published")}
                  className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {scenario.status === "published" ? "Move back to draft" : "Publish scenario"}
                </button>
              </article>
            ))}
            {scenarios.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                No generated scenarios yet. Select KLPs in Browse and generate a draft.
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "export" && (
        <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Integration Export</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              External systems use the existing bearer key. Context-only KLPs are exported as unassessed.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <code className="block rounded bg-muted px-3 py-2 text-foreground">GET /api/integrations/klp/catalog</code>
              <code className="block rounded bg-muted px-3 py-2 text-foreground">GET /api/integrations/klp/results</code>
              <code className="block rounded bg-muted px-3 py-2 text-foreground">GET /api/integrations/students/:provider/:subject/klp-results</code>
            </div>
            <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
              <Download size={16} className="mb-2 text-blue-300" />
              Export success means the learner passed a speaking-performance task linked to the KLP. It does not claim grammar mastery.
            </div>
          </div>
          <pre className="max-h-[520px] overflow-auto rounded-lg border border-border bg-card p-5 text-xs text-muted-foreground">
{JSON.stringify({
  generatedAt: new Date().toISOString(),
  catalogItem: {
    conceptId: "1-1-V-001-a",
    supportStatus: "speaking_scored",
    assessmentMode: "speaking_performance",
  },
  resultItem: {
    assessed: true,
    successScorePercent: 100,
    rawSpeakingScores: {
      pronunciation: 0.84,
      fluency: 0.78,
      targetMatch: 1,
    },
  },
  contextOnlyGrammarItem: {
    supportStatus: "prompt_context_only",
    assessmentMode: "context_only",
    assessed: false,
  },
}, null, 2)}
          </pre>
        </section>
      )}
    </div>
  )
}

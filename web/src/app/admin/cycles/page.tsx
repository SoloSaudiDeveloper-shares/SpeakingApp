"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { CalendarDays, Plus, Loader2, ChevronRight, Trash2, Sparkles, BookTemplate, Check } from "lucide-react"

interface Template {
  id: string
  title: string
  description: string
  cefrLevel: string
  focus: string
  wordCount: number
}

interface Cycle {
  id: number
  startDate: string
  endDate: string
  bookId: number
  book?: { title: string } | null
  enrollmentCount: number
}

interface Book {
  id: number
  title: string
}

interface Student {
  id: number
  fullName: string
  uniqueNumber: string
}

export default function AdminCyclesPage() {
  const [cyclesList, setCyclesList] = useState<Cycle[]>([])
  const [booksList, setBooksList] = useState<Book[]>([])
  const [studentsList, setStudentsList] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ startDate: "", endDate: "", bookId: 0, studentIds: [] as number[] })
  const [saving, setSaving] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [provisioning, setProvisioning] = useState<string | null>(null)
  const [provisioned, setProvisioned] = useState<string | null>(null)

  const load = () => {
    Promise.all([
      fetch("/api/cycles").then((r) => r.json()),
      fetch("/api/books").then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
    ]).then(([c, b, s]) => {
      setCyclesList(c.cycles ?? [])
      setBooksList(b.books ?? [])
      setStudentsList(s.students ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    fetch("/api/admin/curriculum-templates").then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {})
  }, [])

  const provisionTemplate = async (id: string) => {
    setProvisioning(id)
    try {
      const r = await fetch("/api/admin/curriculum-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: id }),
      })
      if (r.ok) {
        setProvisioned(id)
        load()
        setTimeout(() => setProvisioned(null), 2500)
      }
    } catch { /* ignore */ }
    setProvisioning(null)
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      await fetch("/api/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      setShowForm(false)
      load()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const toggleStudent = (id: number) => {
    setFormData((f) => ({
      ...f,
      studentIds: f.studentIds.includes(id)
        ? f.studentIds.filter((s) => s !== id)
        : [...f.studentIds, id],
    }))
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Cycles</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowTemplates((v) => !v)} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition">
            <BookTemplate size={16} /> Start from template
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
            <Plus size={16} /> New Cycle
          </button>
        </div>
      </div>

      {/* Curriculum templates */}
      {showTemplates && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <h2 className="font-semibold text-foreground">Curriculum templates</h2>
            <span className="text-xs text-muted-foreground">— one click creates a ready-made book + 2-week cycle.</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-bold text-primary">{t.cefrLevel}</span>
                  <span className="text-[0.65rem] text-muted-foreground">{t.wordCount} words</span>
                </div>
                <h3 className="mt-2 font-semibold text-foreground">{t.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{t.description}</p>
                <p className="mt-2 text-[0.65rem] text-muted-foreground italic">Focus: {t.focus}</p>
                <button
                  onClick={() => provisionTemplate(t.id)}
                  disabled={provisioning === t.id}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {provisioning === t.id ? <Loader2 size={13} className="animate-spin" />
                    : provisioned === t.id ? <><Check size={13} /> Created!</>
                    : "Use this template"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <input type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <select value={formData.bookId} onChange={(e) => setFormData({ ...formData, bookId: Number(e.target.value) })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm">
              <option value={0}>Select Book</option>
              {booksList.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Enroll students:</p>
            <div className="flex flex-wrap gap-2">
              {studentsList.map((s) => (
                <button key={s.id} onClick={() => toggleStudent(s.id)} className={`rounded-full border px-3 py-1 text-xs transition ${formData.studentIds.includes(s.id) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}>
                  {s.fullName}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleCreate} disabled={saving || !formData.startDate || !formData.endDate || !formData.bookId} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
            {saving ? "Creating..." : "Create Cycle"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {cyclesList.map((c) => (
          <Link
            key={c.id}
            href={`/admin/cycles/${c.id}`}
            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:border-primary hover:shadow-md transition"
          >
            <div className="flex items-center gap-3">
              <CalendarDays size={18} className="text-primary" />
              <div>
                <p className="font-medium text-foreground">{c.book?.title ?? `Book #${c.bookId}`}</p>
                <p className="text-xs text-muted-foreground">{c.startDate} to {c.endDate}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{c.enrollmentCount} enrolled</span>
              <ChevronRight size={18} className="text-muted-foreground group-hover:text-primary" />
            </div>
          </Link>
        ))}
        {cyclesList.length === 0 && (
          <p className="text-muted-foreground text-center py-8">No cycles found. Click New Cycle.</p>
        )}
      </div>
    </div>
  )
}

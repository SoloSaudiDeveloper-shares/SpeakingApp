"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Trash2, UserPlus, CalendarDays, Pencil, Check, X } from "lucide-react"

interface Cycle {
  id: number
  startDate: string
  endDate: string
  bookId: number
  teacherNotes: string | null
  book: { id: number; title: string; cefrLevel: string } | null
  enrollments: Array<{
    studentId: number
    enrolledAt: string
    fullName: string | null
    uniqueNumber: string | null
    class: string | null
    cefrBand: string | null
  }>
}

interface Student { id: number; fullName: string; uniqueNumber: string; class: string | null; cefrBand: string }
interface Book { id: number; title: string; cefrLevel: string }

export default function AdminCycleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [allBooks, setAllBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddEnrollments, setShowAddEnrollments] = useState(false)
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ startDate: "", endDate: "", bookId: 0, teacherNotes: "" })

  const load = () => {
    Promise.all([
      fetch(`/api/cycles/${id}`).then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/books").then((r) => r.json()),
    ])
      .then(([c, s, b]) => {
        const cy = c.cycle ?? null
        setCycle(cy)
        if (cy) {
          setEditForm({
            startDate: cy.startDate.slice(0, 10),
            endDate: cy.endDate.slice(0, 10),
            bookId: cy.bookId,
            teacherNotes: cy.teacherNotes ?? "",
          })
        }
        setAllStudents(s.students ?? [])
        setAllBooks(b.books ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [id])

  const enrolledIds = new Set(cycle?.enrollments.map((e) => e.studentId) ?? [])
  const availableStudents = allStudents.filter((s) => !enrolledIds.has(s.id))

  const addEnrollments = async () => {
    if (selectedStudentIds.size === 0) return
    setSaving(true)
    await fetch(`/api/cycles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollIds: Array.from(selectedStudentIds) }),
    })
    setSelectedStudentIds(new Set())
    setShowAddEnrollments(false)
    setSaving(false)
    load()
  }

  const removeEnrollment = async (studentId: number, name: string | null) => {
    if (!confirm(`Remove ${name ?? "student"} from this cycle? Their attempts will be preserved.`)) return
    await fetch(`/api/cycles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unenrollId: studentId }),
    })
    load()
  }

  const saveCycle = async () => {
    setSaving(true)
    await fetch(`/api/cycles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        bookId: editForm.bookId,
        teacherNotes: editForm.teacherNotes,
      }),
    })
    setEditing(false)
    setSaving(false)
    load()
  }

  const deleteCycle = async () => {
    if (!confirm("Delete this cycle? All enrollments and student attempts in this cycle will be removed.")) return
    const res = await fetch(`/api/cycles/${id}`, { method: "DELETE" })
    if (res.ok) router.push("/admin/cycles")
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }
  if (!cycle) {
    return <div className="p-6">Cycle not found. <Link href="/admin/cycles" className="text-primary">Back</Link></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/cycles" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <CalendarDays size={24} className="text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Cycle #{cycle.id}</h1>
        <div className="flex-1" />
        <button onClick={deleteCycle} className="text-sm text-red-500 hover:underline">Delete cycle</button>
      </div>

      {/* Cycle details */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">Details</h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Start date</label>
                <input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End date</label>
                <input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Book</label>
              <select value={editForm.bookId} onChange={(e) => setEditForm({ ...editForm, bookId: Number(e.target.value) })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm">
                {allBooks.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.cefrLevel})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Teacher notes</label>
              <textarea value={editForm.teacherNotes} onChange={(e) => setEditForm({ ...editForm, teacherNotes: e.target.value })} rows={3} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={saveCycle} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setEditing(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Date Range</dt>
              <dd className="text-foreground">{cycle.startDate.slice(0, 10)} → {cycle.endDate.slice(0, 10)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Book</dt>
              <dd className="text-foreground">{cycle.book?.title ?? "—"} <span className="text-xs text-muted-foreground">({cycle.book?.cefrLevel ?? "—"})</span></dd>
            </div>
            {cycle.teacherNotes && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="text-foreground">{cycle.teacherNotes}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Enrolled students */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Enrolled Students ({cycle.enrollments.length})</h2>
          <button
            onClick={() => setShowAddEnrollments((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <UserPlus size={14} /> Add Students
          </button>
        </div>

        {showAddEnrollments && (
          <div className="border-b border-border bg-muted/20 p-4 space-y-3">
            {availableStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground">All students are already enrolled.</p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-card">
                  {availableStudents.map((s) => {
                    const checked = selectedStudentIds.has(s.id)
                    return (
                      <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/30 border-b border-border last:border-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedStudentIds)
                            if (checked) next.delete(s.id); else next.add(s.id)
                            setSelectedStudentIds(next)
                          }}
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium">{s.fullName}</span>
                          <span className="ml-2 text-xs text-muted-foreground">#{s.uniqueNumber} · {s.class ?? "—"} · {s.cefrBand}</span>
                        </div>
                      </label>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={addEnrollments} disabled={saving || selectedStudentIds.size === 0} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    {saving ? "Adding..." : `Add ${selectedStudentIds.size} student(s)`}
                  </button>
                  <button onClick={() => { setShowAddEnrollments(false); setSelectedStudentIds(new Set()) }} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground bg-muted/30">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">CEFR</th>
              <th className="px-4 py-3">Enrolled</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cycle.enrollments.map((e) => (
              <tr key={e.studentId} className="border-t border-border hover:bg-muted/20">
                <td className="px-4 py-2 text-foreground font-medium">{e.uniqueNumber}</td>
                <td className="px-4 py-2 text-foreground">{e.fullName ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{e.class ?? "—"}</td>
                <td className="px-4 py-2"><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{e.cefrBand}</span></td>
                <td className="px-4 py-2 text-muted-foreground text-xs">{e.enrolledAt.slice(0, 10)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeEnrollment(e.studentId, e.fullName)} className="p-1.5 rounded text-red-500 hover:bg-red-500/10" title="Unenroll">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {cycle.enrollments.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No students enrolled. Click Add Students.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

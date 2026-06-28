"use client"

import { useState, useEffect } from "react"
import { Plus, Loader2, Pencil, Trash2, KeyRound, X, Check, RotateCcw } from "lucide-react"

interface Student {
  id: number
  uniqueNumber: string
  fullName: string
  class: string | null
  cefrBand: string
  isActive: boolean
  hasDiagnostic?: boolean
  diagnosticTakenAt?: string | null
}

const CEFR_BANDS = ["A1", "A2", "B1", "B2"] as const

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ uniqueNumber: "", fullName: "", class: "", cefrBand: "A1", password: "" })
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Student> & { password?: string }>({})
  const [bulkClass, setBulkClass] = useState<string>("")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const load = () => {
    Promise.all([
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/admin/classes").then((r) => r.json()).catch(() => ({ classes: [] })),
    ])
      .then(([sd, cd]) => {
        setStudents(sd.students ?? [])
        setClasses(cd.classes ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        setFormData({ uniqueNumber: "", fullName: "", class: "", cefrBand: "A1", password: "" })
        setShowForm(false)
        load()
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const startEdit = (s: Student) => {
    setEditingId(s.id)
    setEditData({ fullName: s.fullName, class: s.class, cefrBand: s.cefrBand, isActive: s.isActive, password: "" })
  }

  const saveEdit = async (id: number) => {
    setSaving(true)
    const payload: Record<string, unknown> = {
      fullName: editData.fullName,
      class: editData.class || null,
      cefrBand: editData.cefrBand,
      isActive: editData.isActive,
    }
    if (editData.password) payload.password = editData.password
    await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    setEditingId(null)
    setEditData({})
    setSaving(false)
    load()
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete ${name}? This will permanently remove the student, their account, and all their attempts.`)) return
    await fetch(`/api/students/${id}`, { method: "DELETE" })
    load()
  }

  const handleResetPassword = async (id: number, uniqueNumber: string) => {
    const newPw = prompt(`Set new password for ${uniqueNumber}:`, uniqueNumber)
    if (!newPw) return
    await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPw }),
    })
    alert("Password updated.")
  }

  const handleResetDiagnostic = async (id: number, name: string) => {
    if (!confirm(`Reset the speaking check for ${name}? The student will be asked to complete it again.`)) return
    await fetch(`/api/students/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetDiagnostic: true }),
    })
    load()
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const bulkAssignClass = async () => {
    if (selectedIds.size === 0) return
    if (!bulkClass.trim()) return
    if (!confirm(`Assign ${selectedIds.size} student(s) to class "${bulkClass}"?`)) return
    setSaving(true)
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/students/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ class: bulkClass.trim() }),
        })
      )
    )
    setSelectedIds(new Set())
    setBulkClass("")
    setSaving(false)
    load()
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground">{students.length} student{students.length === 1 ? "" : "s"}</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
          <Plus size={16} /> Add Student
        </button>
      </div>

      {/* Bulk assign class */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <input
            list="class-suggestions"
            placeholder="Assign to class..."
            value={bulkClass}
            onChange={(e) => setBulkClass(e.target.value)}
            className="flex-1 max-w-xs bg-background border border-input rounded-md px-3 py-1.5 text-sm"
          />
          <datalist id="class-suggestions">
            {classes.map((c) => <option key={c} value={c} />)}
          </datalist>
          <button
            onClick={bulkAssignClass}
            disabled={!bulkClass.trim() || saving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : "Assign"}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <input placeholder="Student Number" value={formData.uniqueNumber} onChange={(e) => setFormData({ ...formData, uniqueNumber: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <input placeholder="Full Name" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <input list="class-suggestions" placeholder="Class" value={formData.class} onChange={(e) => setFormData({ ...formData, class: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <select value={formData.cefrBand} onChange={(e) => setFormData({ ...formData, cefrBand: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm">
              {CEFR_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <input placeholder="Password (default = number)" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving || !formData.uniqueNumber || !formData.fullName} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
              {saving ? "Creating..." : "Create Student"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground bg-muted/30">
              <th className="px-2 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === students.length && students.length > 0}
                  onChange={(e) => setSelectedIds(e.target.checked ? new Set(students.map(s => s.id)) : new Set())}
                />
              </th>
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">CEFR</th>
              <th className="px-4 py-3">Speaking Check</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const isEditing = editingId === s.id
              return (
                <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} />
                  </td>
                  <td className="px-4 py-2 text-foreground font-medium">{s.uniqueNumber}</td>
                  <td className="px-4 py-2 text-foreground">
                    {isEditing ? (
                      <input
                        value={editData.fullName ?? ""}
                        onChange={(e) => setEditData({ ...editData, fullName: e.target.value })}
                        className="bg-background border border-input rounded-md px-2 py-1 w-full text-sm"
                      />
                    ) : s.fullName}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {isEditing ? (
                      <input
                        list="class-suggestions"
                        value={editData.class ?? ""}
                        onChange={(e) => setEditData({ ...editData, class: e.target.value })}
                        className="bg-background border border-input rounded-md px-2 py-1 w-full text-sm"
                      />
                    ) : (s.class ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <select
                        value={editData.cefrBand ?? s.cefrBand}
                        onChange={(e) => setEditData({ ...editData, cefrBand: e.target.value })}
                        className="bg-background border border-input rounded-md px-2 py-1 text-sm"
                      >
                        {CEFR_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{s.cefrBand}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {s.hasDiagnostic ? (
                      <div>
                        <span className="text-xs font-medium text-emerald-400">Completed</span>
                        {s.diagnosticTakenAt && (
                          <p className="text-[11px] text-muted-foreground">{new Date(s.diagnosticTakenAt).toLocaleDateString()}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-amber-400">Required</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <button
                        onClick={() => setEditData({ ...editData, isActive: !(editData.isActive ?? s.isActive) })}
                        className={`text-xs ${(editData.isActive ?? s.isActive) ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {(editData.isActive ?? s.isActive) ? "Active" : "Inactive"}
                      </button>
                    ) : (
                      s.isActive ? <span className="text-emerald-400 text-xs">Active</span> : <span className="text-red-400 text-xs">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(s.id)} disabled={saving} className="p-1.5 rounded text-green-500 hover:bg-green-500/10" title="Save">
                            <Check size={16} />
                          </button>
                          <button onClick={() => { setEditingId(null); setEditData({}) }} className="p-1.5 rounded text-muted-foreground hover:bg-muted" title="Cancel">
                            <X size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handleResetPassword(s.id, s.uniqueNumber)} className="p-1.5 rounded text-muted-foreground hover:bg-muted" title="Reset password">
                            <KeyRound size={14} />
                          </button>
                          <button onClick={() => handleResetDiagnostic(s.id, s.fullName)} className="p-1.5 rounded text-muted-foreground hover:bg-muted" title="Reset speaking check">
                            <RotateCcw size={14} />
                          </button>
                          <button onClick={() => startEdit(s)} className="p-1.5 rounded text-muted-foreground hover:bg-muted" title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDelete(s.id, s.fullName)} className="p-1.5 rounded text-red-500 hover:bg-red-500/10" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {students.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <datalist id="class-suggestions">
        {classes.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  )
}

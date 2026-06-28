"use client"

import { useEffect, useState } from "react"
import { Loader2, GripVertical, Save, RotateCcw, User, Trash2, Eye, Plus, X } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils/cn"

type StageKey = "listen" | "repeat" | "read-aloud" | "sentence" | "free-speak" | "review"
type UnlockMode = "all" | "sequential" | "free"

const ALL_STAGES: StageKey[] = ["listen", "repeat", "read-aloud", "sentence", "free-speak", "review"]

const STAGE_META: Record<StageKey, { label: string; description: string }> = {
  "listen":     { label: "Listen",     description: "Hear the word" },
  "repeat":     { label: "Repeat",     description: "Say it back" },
  "read-aloud": { label: "Read Aloud", description: "Read and speak" },
  "sentence":   { label: "Sentence",   description: "Use in context" },
  "free-speak": { label: "Free Speak", description: "Express yourself" },
  "review":     { label: "Review",     description: "Test mastery" },
}

const UNLOCK_MODES: { id: UnlockMode; label: string; desc: string }[] = [
  { id: "sequential", label: "Sequential", desc: "Each stage unlocks after the previous one is completed" },
  { id: "all",        label: "All Open",   desc: "All stages are unlocked from day one" },
  { id: "free",       label: "Free Order", desc: "All visible, students decide which to practice" },
]

interface Override {
  studentId: number
  fullName: string
  uniqueNumber: string
  config: { sequence: StageKey[]; unlockMode: UnlockMode }
}

interface Student {
  id: number
  fullName: string
  uniqueNumber: string
  class: string | null
}

export default function AdminStagesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [defaultSequence, setDefaultSequence] = useState<StageKey[]>(ALL_STAGES)
  const [defaultMode, setDefaultMode] = useState<UnlockMode>("sequential")

  const [overrides, setOverrides] = useState<Override[]>([])
  const [students, setStudents] = useState<Student[]>([])

  // Per-student editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorStudentId, setEditorStudentId] = useState<number | null>(null)
  const [editorSequence, setEditorSequence] = useState<StageKey[]>(ALL_STAGES)
  const [editorMode, setEditorMode] = useState<UnlockMode>("sequential")

  const load = async () => {
    setLoading(true)
    try {
      const [cfg, st] = await Promise.all([
        fetch("/api/admin/stage-config").then((r) => r.json()),
        fetch("/api/students").then((r) => r.json()),
      ])
      setDefaultSequence(cfg.defaults?.sequence ?? ALL_STAGES)
      setDefaultMode(cfg.defaults?.unlockMode ?? "sequential")
      setOverrides(cfg.overrides ?? [])
      setStudents(st.students ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const saveDefaults = async () => {
    setSaving(true)
    await fetch("/api/admin/stage-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: defaultSequence, unlockMode: defaultMode }),
    })
    setSaving(false)
    load()
  }

  const resetDefaults = () => {
    setDefaultSequence(ALL_STAGES)
    setDefaultMode("sequential")
  }

  const openOverrideEditor = (studentId: number, existing?: Override) => {
    setEditorStudentId(studentId)
    if (existing) {
      setEditorSequence(existing.config.sequence)
      setEditorMode(existing.config.unlockMode)
    } else {
      // Start from the current default
      setEditorSequence([...defaultSequence])
      setEditorMode(defaultMode)
    }
    setEditorOpen(true)
  }

  const saveOverride = async () => {
    if (!editorStudentId) return
    setSaving(true)
    await fetch(`/api/admin/stage-config/student/${editorStudentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: editorSequence, unlockMode: editorMode }),
    })
    setSaving(false)
    setEditorOpen(false)
    setEditorStudentId(null)
    load()
  }

  const deleteOverride = async (studentId: number) => {
    if (!confirm("Remove this student's override? They'll fall back to the default config.")) return
    await fetch(`/api/admin/stage-config/student/${studentId}`, { method: "DELETE" })
    load()
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  const overrideStudentIds = new Set(overrides.map((o) => o.studentId))
  const studentsWithoutOverride = students.filter((s) => !overrideStudentIds.has(s.id))

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Practice Stages</h1>
        <p className="text-sm text-muted-foreground">
          Control the order students see practice stages and how they unlock. Set a default for everyone, then override for specific students.
        </p>
      </div>

      {/* ────────────── Default Configuration ────────────── */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Default Configuration</h2>
          <p className="text-xs text-muted-foreground">Applies to every student unless they have a personal override.</p>
        </div>

        {/* Unlock Mode */}
        <div>
          <label className="text-sm font-medium text-foreground">Unlock Mode</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {UNLOCK_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setDefaultMode(m.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition",
                  defaultMode === m.id ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30",
                )}
              >
                <div className={cn("text-sm font-medium", defaultMode === m.id ? "text-primary" : "text-foreground")}>
                  {m.label}
                </div>
                <div className="mt-0.5 text-[0.7rem] text-muted-foreground">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Sequence */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">Stage Order</label>
            <span className="text-xs text-muted-foreground">Drag to reorder. Click × to hide.</span>
          </div>
          <SequenceEditor sequence={defaultSequence} onChange={setDefaultSequence} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveDefaults}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "Saving..." : "Save Default"}
          </button>
          <button
            onClick={resetDefaults}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm"
          >
            <RotateCcw size={14} /> Reset to factory default
          </button>
        </div>
      </section>

      {/* ────────────── Per-student Overrides ────────────── */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Per-Student Overrides</h2>
            <p className="text-xs text-muted-foreground">
              Customize the stage order or unlock mode for individual students.
            </p>
          </div>
          <AddStudentOverride students={studentsWithoutOverride} onPick={(id) => openOverrideEditor(id)} />
        </div>

        {overrides.length === 0 ? (
          <p className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground text-center">
            No overrides yet — every student uses the default config.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Student</th>
                  <th className="px-4 py-2">Mode</th>
                  <th className="px-4 py-2">Sequence</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.studentId} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <div className="font-medium text-foreground">{o.fullName}</div>
                      <div className="text-xs text-muted-foreground">#{o.uniqueNumber}</div>
                    </td>
                    <td className="px-4 py-2 text-foreground">
                      {UNLOCK_MODES.find((m) => m.id === o.config.unlockMode)?.label}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {o.config.sequence.map((s) => STAGE_META[s as StageKey]?.label).filter(Boolean).join(" → ")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => openOverrideEditor(o.studentId, o)} className="p-1.5 rounded text-muted-foreground hover:bg-muted">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => deleteOverride(o.studentId)} className="p-1.5 rounded text-red-500 hover:bg-red-500/10">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ────────────── Override Editor Modal ────────────── */}
      {editorOpen && editorStudentId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User size={18} />
                <h3 className="text-lg font-semibold text-foreground">
                  Override for {students.find((s) => s.id === editorStudentId)?.fullName ?? `Student #${editorStudentId}`}
                </h3>
              </div>
              <button onClick={() => { setEditorOpen(false); setEditorStudentId(null) }} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Unlock Mode</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {UNLOCK_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setEditorMode(m.id)}
                    className={cn(
                      "rounded-md border p-2 text-left transition text-xs",
                      editorMode === m.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-foreground/30 text-foreground",
                    )}
                  >
                    <div className="font-medium">{m.label}</div>
                    <div className="mt-0.5 text-[0.65rem] text-muted-foreground">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Stage Order</label>
              <SequenceEditor sequence={editorSequence} onChange={setEditorSequence} />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditorOpen(false); setEditorStudentId(null) }} className="rounded-md border border-border px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={saveOverride}
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function SequenceEditor({
  sequence,
  onChange,
}: {
  sequence: StageKey[]
  onChange: (s: StageKey[]) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sequence.findIndex((k) => k === active.id)
    const newIdx = sequence.findIndex((k) => k === over.id)
    onChange(arrayMove(sequence, oldIdx, newIdx))
  }

  const remove = (key: StageKey) => onChange(sequence.filter((s) => s !== key))
  const add = (key: StageKey) => onChange([...sequence, key])

  const hidden = ALL_STAGES.filter((s) => !sequence.includes(s))

  return (
    <div className="space-y-3 mt-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sequence} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {sequence.map((key, i) => (
              <SortableItem key={key} id={key} index={i} onRemove={() => remove(key)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {hidden.length > 0 && (
        <div className="rounded-md border border-dashed border-border p-3">
          <p className="mb-2 text-xs text-muted-foreground">Hidden stages — click + to add</p>
          <div className="flex flex-wrap gap-2">
            {hidden.map((key) => (
              <button
                key={key}
                onClick={() => add(key)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs hover:bg-muted"
              >
                <Plus size={12} /> {STAGE_META[key].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SortableItem({ id, index, onRemove }: { id: StageKey; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const meta = STAGE_META[id]
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-md border bg-card p-3 text-sm",
        isDragging ? "border-primary shadow-lg" : "border-border",
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground touch-none">
        <GripVertical size={16} />
      </button>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">{index + 1}</span>
      <div className="flex-1">
        <div className="font-medium text-foreground">{meta.label}</div>
        <div className="text-xs text-muted-foreground">{meta.description}</div>
      </div>
      <button onClick={onRemove} className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10" title="Hide this stage">
        <X size={14} />
      </button>
    </li>
  )
}

function AddStudentOverride({
  students,
  onPick,
}: {
  students: Student[]
  onPick: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const filtered = filter
    ? students.filter((s) =>
        s.fullName.toLowerCase().includes(filter.toLowerCase()) ||
        s.uniqueNumber.toLowerCase().includes(filter.toLowerCase()),
      )
    : students.slice(0, 50)

  if (students.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus size={14} /> Add Override
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md border border-border bg-card shadow-lg">
          <input
            placeholder="Search students..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full border-b border-border bg-background px-3 py-2 text-sm focus:outline-none"
            autoFocus
          />
          <ul className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="p-3 text-center text-sm text-muted-foreground">No matches.</li>
            ) : (
              filtered.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => { setOpen(false); setFilter(""); onPick(s.id) }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <div className="font-medium">{s.fullName}</div>
                    <div className="text-xs text-muted-foreground">#{s.uniqueNumber} · {s.class ?? "no class"}</div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

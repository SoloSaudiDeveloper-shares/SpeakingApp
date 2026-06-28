"use client"

import { useState, useEffect } from "react"
import { Loader2, Plus, BookOpen, CheckSquare, Save, Pencil, Trash2, Power, Check, X } from "lucide-react"

interface VocabItem {
  id: number
  word: string
  arabicMeaning: string | null
  bookId: number
}

interface Book {
  id: number
  title: string
  cefrLevel: string
}

interface PracticeSet {
  id: number
  name: string
  bookId: number | null
  wordIds: string
  taskTypes: string
  isActive: boolean
  createdAt: string
}

const TASK_TYPES = [
  "ListenRepeat",
  "ReadAloud",
  "SentenceFrame",
  "FreeRecall",
  "Dictation",
]

export default function PracticeSetsPage() {
  const [sets, setSets] = useState<PracticeSet[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Form state (used for both create and edit)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState("")
  const [selectedWords, setSelectedWords] = useState<number[]>([])
  const [selectedTasks, setSelectedTasks] = useState<string[]>([])
  const [selectedBook, setSelectedBook] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const [booksData, settingsData] = await Promise.all([
        fetch("/api/books").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
      ])
      setBooks(booksData.books ?? [])
      const psRaw = settingsData.settings?.find(
        (s: { key: string; value: string }) => s.key === "custom_practice_sets"
      )
      if (psRaw) {
        try {
          setSets(JSON.parse(psRaw.value))
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadVocabForBook = async (bookId: number) => {
    setSelectedBook(bookId)
    if (!bookId) { setVocab([]); return }
    try {
      const res = await fetch(`/api/books/${bookId}/vocabulary`)
      if (res.ok) {
        const data = await res.json()
        setVocab(data.vocabulary ?? [])
      }
    } catch { setVocab([]) }
  }

  const persistSets = async (updated: PracticeSet[]) => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_practice_sets: JSON.stringify(updated) }),
    })
    setSets(updated)
  }

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setSelectedWords([])
    setSelectedTasks([])
    setSelectedBook(null)
    setVocab([])
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      let updated: PracticeSet[]
      if (editingId !== null) {
        updated = sets.map((s) =>
          s.id === editingId
            ? {
                ...s,
                name: name.trim(),
                bookId: selectedBook,
                wordIds: JSON.stringify(selectedWords),
                taskTypes: JSON.stringify(selectedTasks),
              }
            : s
        )
      } else {
        const newSet: PracticeSet = {
          id: Date.now(),
          name: name.trim(),
          bookId: selectedBook,
          wordIds: JSON.stringify(selectedWords),
          taskTypes: JSON.stringify(selectedTasks),
          isActive: true,
          createdAt: new Date().toISOString(),
        }
        updated = [...sets, newSet]
      }
      await persistSets(updated)
      resetForm()
      setShowCreate(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const startEdit = (s: PracticeSet) => {
    setEditingId(s.id)
    setName(s.name)
    setSelectedBook(s.bookId ?? null)
    setSelectedWords(JSON.parse(s.wordIds || "[]"))
    setSelectedTasks(JSON.parse(s.taskTypes || "[]"))
    setShowCreate(true)
    if (s.bookId) loadVocabForBook(s.bookId)
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete practice set "${name}"?`)) return
    await persistSets(sets.filter((s) => s.id !== id))
  }

  const handleToggleActive = async (id: number) => {
    await persistSets(sets.map((s) => s.id === id ? { ...s, isActive: !s.isActive } : s))
  }

  const toggleWord = (id: number) => {
    setSelectedWords((prev) => prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id])
  }

  const toggleTask = (t: string) => {
    setSelectedTasks((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Practice Sets</h1>
        <button
          onClick={() => { resetForm(); setShowCreate((v) => !v) }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
        >
          <Plus size={16} /> Create New Set
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <BookOpen size={20} className="text-primary mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground">Custom Practice Sets</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create targeted word groups for students. Select words from a book and choose which task types to include.
            </p>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {editingId !== null ? "Edit Practice Set" : "New Practice Set"}
          </h2>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Set Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Unit 3 Review"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Select Book</label>
            <select
              value={selectedBook ?? ""}
              onChange={(e) => loadVocabForBook(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a book...</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.title} ({b.cefrLevel})</option>
              ))}
            </select>
          </div>

          {vocab.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground">
                  Words ({selectedWords.length} of {vocab.length} selected)
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedWords(vocab.map((v) => v.id))}
                    className="text-xs text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedWords([])}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto rounded-md border border-border p-3">
                {vocab.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedWords.includes(v.id)}
                      onChange={() => toggleWord(v.id)}
                      className="rounded border-input"
                    />
                    <span>{v.word}</span>
                    {v.arabicMeaning && (
                      <span className="text-xs text-muted-foreground" dir="rtl">{v.arabicMeaning}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectedBook && vocab.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No vocabulary in this book yet. Add words on the Books page first.
            </p>
          )}

          <div>
            <label className="text-sm font-medium text-muted-foreground">Task Types</label>
            <div className="mt-2 flex flex-wrap gap-3">
              {TASK_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTasks.includes(t)}
                    onChange={() => toggleTask(t)}
                    className="rounded border-input"
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              <Save size={16} /> {saving ? "Saving..." : (editingId !== null ? "Save Changes" : "Create Set")}
            </button>
            <button
              onClick={() => { resetForm(); setShowCreate(false) }}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sets.length > 0 ? (
          sets.map((s) => {
            let wordCount = 0
            let taskList: string[] = []
            try { wordCount = JSON.parse(s.wordIds).length } catch { /* ignore */ }
            try { taskList = JSON.parse(s.taskTypes) } catch { /* ignore */ }
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckSquare size={18} className={s.isActive ? "text-emerald-400" : "text-muted-foreground"} />
                  <div>
                    <h3 className="font-semibold text-foreground">{s.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {wordCount} words &middot; {taskList.join(", ") || "All tasks"} &middot;{" "}
                      <span className={s.isActive ? "text-emerald-400" : "text-amber-500"}>
                        {s.isActive ? "Active" : "Inactive"}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(s.id)}
                    className="p-2 rounded text-muted-foreground hover:bg-muted"
                    title={s.isActive ? "Deactivate" : "Activate"}
                  >
                    <Power size={16} />
                  </button>
                  <button
                    onClick={() => startEdit(s)}
                    className="p-2 rounded text-muted-foreground hover:bg-muted"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id, s.name)}
                    className="p-2 rounded text-red-500 hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <p className="text-muted-foreground text-center py-8">
            No practice sets yet. Click &quot;Create New Set&quot; to get started.
          </p>
        )}
      </div>
    </div>
  )
}

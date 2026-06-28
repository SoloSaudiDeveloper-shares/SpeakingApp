"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Loader2, Pencil, Trash2, Check, X, BookOpen } from "lucide-react"

interface Vocab {
  id: number
  bookId: number
  word: string
  arabicMeaning: string | null
  partOfSpeech: string | null
  exampleSentence: string | null
  unit: number | null
  difficultyTier: number | null
  sortOrder: number | null
}

interface Book {
  id: number
  title: string
  cefrLevel: string
  totalWords: number
}

const CEFR_LEVELS = ["A1", "A2", "B1", "B2"]

export default function AdminBookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [book, setBook] = useState<Book | null>(null)
  const [vocab, setVocab] = useState<Vocab[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newWord, setNewWord] = useState({ word: "", arabicMeaning: "", partOfSpeech: "", exampleSentence: "", unit: 1 })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Vocab>>({})
  const [editingBook, setEditingBook] = useState(false)
  const [bookEdit, setBookEdit] = useState<{ title: string; cefrLevel: string }>({ title: "", cefrLevel: "A1" })
  const [search, setSearch] = useState("")

  const load = () => {
    fetch(`/api/books/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setBook(d.book ?? null)
        setVocab(d.vocabulary ?? [])
        if (d.book) setBookEdit({ title: d.book.title, cefrLevel: d.book.cefrLevel })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [id])

  const handleAdd = async () => {
    if (!newWord.word.trim()) return
    setSaving(true)
    await fetch(`/api/books/${id}/vocabulary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newWord),
    })
    setNewWord({ word: "", arabicMeaning: "", partOfSpeech: "", exampleSentence: "", unit: 1 })
    setShowAddForm(false)
    setSaving(false)
    load()
  }

  const startEdit = (v: Vocab) => {
    setEditingId(v.id)
    setEditData({
      word: v.word,
      arabicMeaning: v.arabicMeaning,
      partOfSpeech: v.partOfSpeech,
      exampleSentence: v.exampleSentence,
      unit: v.unit ?? 1,
    })
  }

  const saveEdit = async (vocabId: number) => {
    setSaving(true)
    await fetch(`/api/vocabulary/${vocabId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    })
    setEditingId(null)
    setEditData({})
    setSaving(false)
    load()
  }

  const handleDeleteVocab = async (vocabId: number, word: string) => {
    if (!confirm(`Delete word "${word}"?`)) return
    await fetch(`/api/vocabulary/${vocabId}`, { method: "DELETE" })
    load()
  }

  const saveBook = async () => {
    setSaving(true)
    await fetch(`/api/books/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookEdit),
    })
    setEditingBook(false)
    setSaving(false)
    load()
  }

  const handleDeleteBook = async () => {
    if (!book) return
    if (!confirm(`Delete book "${book.title}" and all its words? This cannot be undone.`)) return
    const res = await fetch(`/api/books/${id}`, { method: "DELETE" })
    if (res.ok) {
      router.push("/admin/books")
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || "Delete failed.")
    }
  }

  const filteredVocab = vocab.filter((v) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return v.word.toLowerCase().includes(q) ||
      (v.arabicMeaning?.toLowerCase().includes(q) ?? false) ||
      (v.partOfSpeech?.toLowerCase().includes(q) ?? false)
  })

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  if (!book) {
    return <div className="p-6">Book not found. <Link href="/admin/books" className="text-primary">Back to books</Link></div>
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/books" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </Link>
        <BookOpen size={24} className="text-primary" />
        <div className="flex-1">
          {editingBook ? (
            <div className="flex items-center gap-2">
              <input
                value={bookEdit.title}
                onChange={(e) => setBookEdit({ ...bookEdit, title: e.target.value })}
                className="bg-background border border-input rounded-md px-3 py-1.5 text-lg font-semibold w-full max-w-md"
              />
              <select
                value={bookEdit.cefrLevel}
                onChange={(e) => setBookEdit({ ...bookEdit, cefrLevel: e.target.value })}
                className="bg-background border border-input rounded-md px-3 py-1.5 text-sm"
              >
                {CEFR_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <button onClick={saveBook} disabled={saving} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Save</button>
              <button onClick={() => setEditingBook(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{book.title}</h1>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{book.cefrLevel}</span>
              <span className="text-sm text-muted-foreground">· {vocab.length} word{vocab.length === 1 ? "" : "s"}</span>
              <button onClick={() => setEditingBook(true)} className="text-sm text-primary hover:underline">Edit</button>
              <button onClick={handleDeleteBook} className="text-sm text-red-500 hover:underline">Delete book</button>
            </div>
          )}
        </div>
      </div>

      {/* Search & add */}
      <div className="flex items-center gap-3">
        <input
          placeholder="Search words..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md bg-background border border-input rounded-md px-3 py-2 text-sm"
        />
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
        >
          <Plus size={16} /> Add Word
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <input placeholder="Word (English)" value={newWord.word} onChange={(e) => setNewWord({ ...newWord, word: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 text-sm" />
            <input placeholder="Arabic meaning" value={newWord.arabicMeaning} onChange={(e) => setNewWord({ ...newWord, arabicMeaning: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 text-sm" dir="rtl" />
            <input placeholder="Part of speech" value={newWord.partOfSpeech} onChange={(e) => setNewWord({ ...newWord, partOfSpeech: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 text-sm" />
            <input placeholder="Example sentence" value={newWord.exampleSentence} onChange={(e) => setNewWord({ ...newWord, exampleSentence: e.target.value })} className="bg-background border border-input rounded-md px-3 py-2 text-sm md:col-span-2" />
            <input type="number" placeholder="Unit" value={newWord.unit} onChange={(e) => setNewWord({ ...newWord, unit: Number(e.target.value) })} className="bg-background border border-input rounded-md px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !newWord.word.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
              {saving ? "Adding..." : "Add Word"}
            </button>
            <button onClick={() => setShowAddForm(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Vocabulary table */}
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground bg-muted/30">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Word</th>
              <th className="px-4 py-3">Arabic</th>
              <th className="px-4 py-3">POS</th>
              <th className="px-4 py-3">Example</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredVocab.map((v, idx) => {
              const isEditing = editingId === v.id
              return (
                <tr key={v.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-2 text-muted-foreground text-xs">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium text-foreground">
                    {isEditing ? (
                      <input value={editData.word ?? ""} onChange={(e) => setEditData({ ...editData, word: e.target.value })} className="bg-background border border-input rounded-md px-2 py-1 text-sm w-full" />
                    ) : v.word}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground" dir="rtl">
                    {isEditing ? (
                      <input value={editData.arabicMeaning ?? ""} onChange={(e) => setEditData({ ...editData, arabicMeaning: e.target.value })} className="bg-background border border-input rounded-md px-2 py-1 text-sm w-full" />
                    ) : (v.arabicMeaning ?? "—")}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {isEditing ? (
                      <input value={editData.partOfSpeech ?? ""} onChange={(e) => setEditData({ ...editData, partOfSpeech: e.target.value })} className="bg-background border border-input rounded-md px-2 py-1 text-sm w-full" />
                    ) : (v.partOfSpeech ?? "—")}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs max-w-xs truncate">
                    {isEditing ? (
                      <input value={editData.exampleSentence ?? ""} onChange={(e) => setEditData({ ...editData, exampleSentence: e.target.value })} className="bg-background border border-input rounded-md px-2 py-1 text-sm w-full" />
                    ) : (v.exampleSentence ?? "—")}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {isEditing ? (
                      <input type="number" value={editData.unit ?? 1} onChange={(e) => setEditData({ ...editData, unit: Number(e.target.value) })} className="bg-background border border-input rounded-md px-2 py-1 text-sm w-16" />
                    ) : (v.unit ?? "—")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(v.id)} disabled={saving} className="p-1.5 rounded text-green-500 hover:bg-green-500/10"><Check size={14} /></button>
                          <button onClick={() => { setEditingId(null); setEditData({}) }} className="p-1.5 rounded text-muted-foreground hover:bg-muted"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(v)} className="p-1.5 rounded text-muted-foreground hover:bg-muted"><Pencil size={14} /></button>
                          <button onClick={() => handleDeleteVocab(v.id, v.word)} className="p-1.5 rounded text-red-500 hover:bg-red-500/10"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filteredVocab.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{search ? "No matching words." : "No words yet. Click Add Word."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

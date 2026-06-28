"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  Sparkles,
  Save,
  X,
  Calendar,
  Hash,
  ArrowRight,
} from "lucide-react"

interface StudentText {
  id: number
  title: string
  originalText: string
  summary: string | null
  wordCount: number
  createdAt: string
  lastPracticedAt: string | null
}

export default function TextLibraryPage() {
  const [texts, setTexts] = useState<StudentText[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [originalText, setOriginalText] = useState("")
  const [summary, setSummary] = useState("")
  const [saving, setSaving] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  const loadTexts = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/text-practice")
      if (res.ok) {
        const data = await res.json()
        setTexts(data.texts ?? [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadTexts() }, [])

  const handleSave = async () => {
    if (!title.trim() || !originalText.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/text-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          originalText: originalText.trim(),
          summary: summary.trim() || undefined,
        }),
      })
      if (res.ok) {
        setTitle("")
        setOriginalText("")
        setSummary("")
        setShowForm(false)
        loadTexts()
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleSummarize = async () => {
    if (!originalText.trim()) return
    setSummarizing(true)
    try {
      const res = await fetch("/api/text-practice/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: originalText.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary ?? "")
      }
    } catch { /* ignore */ }
    setSummarizing(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this text and all its practice attempts?")) return
    setDeleting(id)
    try {
      await fetch(`/api/text-practice/${id}`, { method: "DELETE" })
      loadTexts()
    } catch { /* ignore */ }
    setDeleting(null)
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText size={24} className="text-primary" />
            My Text Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Save texts and practice speaking them for accuracy and fluency.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/practice/texts/lists"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition"
          >
            <BookOpen size={14} />
            Word Lists
          </Link>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? "Cancel" : "Create New Text"}
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-foreground">New Text</h2>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. My Weekend Story"
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Text</label>
            <textarea
              value={originalText}
              onChange={(e) => setOriginalText(e.target.value)}
              placeholder="Paste or type your text here..."
              rows={8}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full resize-y"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {originalText.split(/\s+/).filter(Boolean).length} words
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-foreground">Summary (optional)</label>
              <button
                onClick={handleSummarize}
                disabled={summarizing || !originalText.trim()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
              >
                {summarizing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                {summarizing ? "Summarizing..." : "Summarize with AI"}
              </button>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="AI-generated or manual summary..."
              rows={3}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm w-full resize-y"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !originalText.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : "Save Text"}
            </button>
          </div>
        </div>
      )}

      {/* Text Cards */}
      {texts.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <FileText size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground mb-2">No texts saved yet.</p>
          <p className="text-sm text-muted-foreground">
            Create your first text to start practicing!
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {texts.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/30 transition"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-base font-semibold text-foreground line-clamp-1">{t.title}</h3>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={deleting === t.id}
                  className="text-muted-foreground hover:text-red-400 transition shrink-0"
                  title="Delete"
                >
                  {deleting === t.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                {t.summary || t.originalText.slice(0, 150)}
              </p>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <Hash size={11} />
                  {t.wordCount} words
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(t.createdAt).toLocaleDateString()}
                </span>
                {t.lastPracticedAt && (
                  <span>
                    Last practiced: {new Date(t.lastPracticedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <Link
                href={`/practice/texts/${t.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Practice <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

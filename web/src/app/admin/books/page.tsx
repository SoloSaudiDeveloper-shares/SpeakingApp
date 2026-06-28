"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { BookOpen, Upload, Loader2, ChevronRight } from "lucide-react"

interface Book {
  id: number
  title: string
  cefrLevel: string
  totalWords: number
}

export default function AdminBooksPage() {
  const [booksList, setBooksList] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [title, setTitle] = useState("")
  const [cefr, setCefr] = useState("A1")
  const [csvText, setCsvText] = useState("")
  const [saving, setSaving] = useState(false)

  const load = () => {
    fetch("/api/books")
      .then((r) => r.json())
      .then((d) => setBooksList(d.books ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleImport = async () => {
    setSaving(true)
    try {
      const lines = csvText.trim().split("\n").filter(Boolean)
      const words = lines.map((line, i) => {
        const parts = line.split(",").map((s) => s.trim())
        return {
          word: parts[0] || "",
          arabicMeaning: parts[1] || "",
          partOfSpeech: parts[2] || "",
          exampleSentence: parts[3] || "",
          unit: i + 1,
        }
      }).filter((w) => w.word)

      await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, cefrLevel: cefr, words }),
      })
      setTitle("")
      setCsvText("")
      setShowImport(false)
      load()
    } catch { /* ignore */ }
    setSaving(false)
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-primary" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Books</h1>
        <button onClick={() => setShowImport((v) => !v)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition">
          <Upload size={16} /> Import Book
        </button>
      </div>

      {showImport && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Book Title" value={title} onChange={(e) => setTitle(e.target.value)} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm" />
            <select value={cefr} onChange={(e) => setCefr(e.target.value)} className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm">
              <option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option>
            </select>
          </div>
          <textarea
            placeholder="CSV: word, arabic, pos, example (one per line)"
            rows={6}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="bg-background border border-input rounded-md px-3 py-2 w-full text-sm font-mono"
          />
          <button onClick={handleImport} disabled={saving || !title || !csvText} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
            {saving ? "Importing..." : "Import"}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {booksList.map((b) => (
          <Link
            key={b.id}
            href={`/admin/books/${b.id}`}
            className="group rounded-lg border border-border bg-card p-4 shadow-sm hover:border-primary hover:shadow-md transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <BookOpen size={20} className="text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{b.title}</h3>
                  <p className="text-sm text-muted-foreground">{b.cefrLevel} &middot; {b.totalWords} words</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted-foreground group-hover:text-primary shrink-0" />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Click to view, edit, or add words →
            </div>
          </Link>
        ))}
        {booksList.length === 0 && (
          <p className="text-muted-foreground col-span-full text-center py-8">No books found. Click Import Book.</p>
        )}
      </div>
    </div>
  )
}

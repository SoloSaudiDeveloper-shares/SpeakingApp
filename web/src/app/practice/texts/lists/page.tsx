"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  BookOpen,
  Trash2,
  ChevronDown,
  ChevronRight,
  Hash,
  Calendar,
} from "lucide-react"

interface WordListItem {
  word: string
  meaning?: string
  fromTextId?: number
}

interface WordList {
  id: number
  name: string
  words: string
  createdAt: string
  lastPracticedAt: string | null
}

export default function WordListsPage() {
  const [lists, setLists] = useState<WordList[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  const loadLists = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/text-practice/word-lists")
      if (res.ok) {
        const data = await res.json()
        setLists(data.lists ?? [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadLists() }, [])

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this word list?")) return
    setDeleting(id)
    try {
      await fetch(`/api/text-practice/word-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      })
      loadLists()
    } catch { /* ignore */ }
    setDeleting(null)
  }

  const parseWords = (wordsStr: string): WordListItem[] => {
    try {
      return JSON.parse(wordsStr)
    } catch {
      return []
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/practice/texts" className="text-muted-foreground hover:text-foreground transition">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen size={24} className="text-primary" />
            My Word Lists
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Custom word lists created from your text practice sessions.
          </p>
        </div>
      </div>

      {/* Lists */}
      {lists.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground mb-2">No word lists yet.</p>
          <p className="text-sm text-muted-foreground">
            Practice texts and save your weak words to create lists.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => {
            const words = parseWords(list.words)
            const isExpanded = expandedId === list.id

            return (
              <div
                key={list.id}
                className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
              >
                {/* List Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition"
                  onClick={() => setExpandedId(isExpanded ? null : list.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground truncate">{list.name}</h3>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1">
                          <Hash size={10} />
                          {words.length} words
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {new Date(list.createdAt).toLocaleDateString()}
                        </span>
                        {list.lastPracticedAt && (
                          <span>Last practiced: {new Date(list.lastPracticedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(list.id)
                    }}
                    disabled={deleting === list.id}
                    className="text-muted-foreground hover:text-red-400 transition shrink-0 ml-2"
                    title="Delete"
                  >
                    {deleting === list.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>

                {/* Expanded Words */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 bg-muted/10">
                    <div className="flex flex-wrap gap-2">
                      {words.map((w, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-border bg-background px-3 py-1.5"
                        >
                          <span className="text-sm font-medium text-foreground">{w.word}</span>
                          {w.meaning && (
                            <span className="text-xs text-muted-foreground ml-2">({w.meaning})</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {words.length === 0 && (
                      <p className="text-sm text-muted-foreground">No words in this list.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

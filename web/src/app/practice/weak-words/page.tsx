"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, BookOpen, FileText, Loader2, Mic, MessageSquare, Target, TrendingUp } from "lucide-react"

interface VocabItem {
  id: number
  word: string
  arabicMeaning: string | null
  exampleSentence?: string | null
  klpLinks?: KlpLink[]
}

interface KlpLink {
  id: number
  conceptId: string
  book: string | null
  lesson: string | null
  domain: string
  label: string
  supportStatus: string
}

interface MasteryRecord {
  vocabularyItemId: number
  masteryStatus: string
  bestScore: number
  latestScore?: number
  timesSpoken?: number
  vocabulary?: { word: string }
}

interface PracticeData {
  cycle: { id: number } | null
  book: { title: string; cefrLevel: string } | null
  vocabulary: VocabItem[]
  mastery: MasteryRecord[]
  attempts?: PracticeAttempt[]
}

interface PracticeAttempt {
  id: number
  metricsJson?: string | null
}

interface WordList {
  id: number
  name: string
  words: string
}

interface FluencySession {
  id: number
  drillType: string
  roundsJson: string
}

interface TextWord {
  word: string
  meaning?: string
  accuracy?: number
  errorType?: string
}

interface WeakWord {
  key: string
  word: string
  meaning: string | null
  vocabId: number | null
  source: "practice" | "text" | "fluency" | "pronunciation" | "multiple"
  status: string
  latestScore: number | null
  bestScore: number | null
  timesSpoken: number
  klpLinks: KlpLink[]
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "").trim()
}

function pct(score: number | null) {
  return score === null ? "No score" : `${Math.round(score * 100)}%`
}

function parseWordListWords(raw: string): TextWord[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (typeof item === "string") return { word: item }
        if (item && typeof item === "object" && "word" in item) {
          const word = String((item as { word?: unknown }).word ?? "").trim()
          const meaning = (item as { meaning?: unknown }).meaning
          return word ? { word, meaning: typeof meaning === "string" ? meaning : undefined } : null
        }
        return null
      })
      .filter((item): item is TextWord => !!item?.word)
  } catch {
    return []
  }
}

function parseFluencyWeakWords(raw: string): TextWord[] {
  try {
    const rounds = JSON.parse(raw) as unknown
    if (!Array.isArray(rounds)) return []
    return rounds.flatMap((round) => {
      if (!round || typeof round !== "object") return []
      const weakWords = (round as { weakWords?: unknown }).weakWords
      if (!Array.isArray(weakWords)) return []
      return weakWords
        .filter((word): word is string => typeof word === "string" && word.trim().length > 0)
        .map((word) => ({ word }))
    })
  } catch {
    return []
  }
}

function parsePronunciationWeakWords(raw: string | null | undefined): TextWord[] {
  if (!raw) return []
  try {
    const metrics = JSON.parse(raw) as unknown
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return []
    const evidence = (metrics as { pronunciationWeakWords?: unknown }).pronunciationWeakWords
    if (!Array.isArray(evidence)) return []
    return evidence
      .flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const obj = item as { word?: unknown; accuracy?: unknown; errorType?: unknown }
        const word = typeof obj.word === "string" ? obj.word.trim() : ""
        const accuracy = typeof obj.accuracy === "number" ? obj.accuracy : Number(obj.accuracy)
        const errorType = typeof obj.errorType === "string" ? obj.errorType : "Pronunciation"
        if (!word || !Number.isFinite(accuracy)) return []
        return [{ word, accuracy: Math.max(0, Math.min(100, accuracy)), errorType }]
      })
  } catch {
    return []
  }
}

function severity(word: WeakWord) {
  if (word.source === "pronunciation" || word.status.startsWith("Pronunciation") || word.status === "Mispronunciation" || word.status === "Omission") return "Pronunciation"
  if (word.latestScore !== null && word.latestScore < 0.5) return "Needs repair"
  if (word.latestScore !== null && word.latestScore < 0.75) return "Needs practice"
  if (word.status === "Attempted") return "Needs practice"
  if (word.status === "Developing") return "Developing"
  return "From text practice"
}

function badgeClass(label: string) {
  if (label === "Needs repair") return "border-red-500/40 bg-red-500/15 text-red-300"
  if (label === "Pronunciation") return "border-rose-500/40 bg-rose-500/15 text-rose-300"
  if (label === "Needs practice") return "border-amber-500/40 bg-amber-500/15 text-amber-300"
  if (label === "Developing") return "border-blue-500/40 bg-blue-500/15 text-blue-300"
  return "border-violet-500/40 bg-violet-500/15 text-violet-300"
}

function mergeSource(existing: WeakWord["source"], next: WeakWord["source"]): WeakWord["source"] {
  if (existing === next) return existing
  return "multiple"
}

function sourceLabel(source: WeakWord["source"]) {
  if (source === "pronunciation") return "Pronunciation"
  if (source === "text") return "Text practice"
  if (source === "fluency") return "Fluency drill"
  if (source === "multiple") return "Multiple sources"
  return "Practice"
}

export default function WeakWordsPage() {
  const [practiceData, setPracticeData] = useState<PracticeData | null>(null)
  const [wordLists, setWordLists] = useState<WordList[]>([])
  const [fluencySessions, setFluencySessions] = useState<FluencySession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [practiceRes, listsRes, fluencyRes] = await Promise.all([
          fetch("/api/practice"),
          fetch("/api/text-practice/word-lists"),
          fetch("/api/practice/fluency"),
        ])
        const practiceJson = practiceRes.ok ? await practiceRes.json() : null
        const listsJson = listsRes.ok ? await listsRes.json() : { lists: [] }
        const fluencyJson = fluencyRes.ok ? await fluencyRes.json() : { sessions: [] }
        if (!cancelled) {
          setPracticeData(practiceJson)
          setWordLists(Array.isArray(listsJson?.lists) ? listsJson.lists : [])
          setFluencySessions(Array.isArray(fluencyJson?.sessions) ? fluencyJson.sessions : [])
        }
      } catch {
        if (!cancelled) {
          setPracticeData(null)
          setWordLists([])
          setFluencySessions([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const weakWords = useMemo(() => {
    const words = new Map<string, WeakWord>()
    const vocabByKey = new Map<string, VocabItem>()

    for (const vocab of practiceData?.vocabulary ?? []) {
      vocabByKey.set(normalizeWord(vocab.word), vocab)
    }

    for (const record of practiceData?.mastery ?? []) {
      if (record.masteryStatus === "Mastered") continue
      const vocab = practiceData?.vocabulary.find((v) => v.id === record.vocabularyItemId)
      const rawWord = vocab?.word ?? record.vocabulary?.word
      if (!rawWord) continue
      const key = normalizeWord(rawWord)
      if (!key) continue
      const latest = typeof record.latestScore === "number" ? record.latestScore : record.bestScore
      if (record.masteryStatus === "Developing" || record.masteryStatus === "Attempted" || latest < 0.85) {
        words.set(key, {
          key,
          word: rawWord,
          meaning: vocab?.arabicMeaning ?? null,
          vocabId: vocab?.id ?? record.vocabularyItemId,
          source: "practice",
          status: record.masteryStatus,
          latestScore: latest,
          bestScore: record.bestScore,
          timesSpoken: record.timesSpoken ?? 0,
          klpLinks: vocab?.klpLinks ?? [],
        })
      }
    }

    for (const list of wordLists) {
      for (const item of parseWordListWords(list.words)) {
        const key = normalizeWord(item.word)
        if (!key) continue
        const existing = words.get(key)
        if (existing) {
          words.set(key, { ...existing, source: mergeSource(existing.source, "text") })
          continue
        }
        const vocab = vocabByKey.get(key)
        words.set(key, {
          key,
          word: vocab?.word ?? item.word,
          meaning: vocab?.arabicMeaning ?? item.meaning ?? null,
          vocabId: vocab?.id ?? null,
          source: "text",
          status: "Text practice",
          latestScore: null,
          bestScore: null,
          timesSpoken: 0,
          klpLinks: vocab?.klpLinks ?? [],
        })
      }
    }

    for (const session of fluencySessions) {
      for (const item of parseFluencyWeakWords(session.roundsJson)) {
        const key = normalizeWord(item.word)
        if (!key) continue
        const existing = words.get(key)
        if (existing) {
          words.set(key, { ...existing, source: mergeSource(existing.source, "fluency") })
          continue
        }
        const vocab = vocabByKey.get(key)
        words.set(key, {
          key,
          word: vocab?.word ?? item.word,
          meaning: vocab?.arabicMeaning ?? null,
          vocabId: vocab?.id ?? null,
          source: "fluency",
          status: "Fluency drill",
          latestScore: null,
          bestScore: null,
          timesSpoken: 0,
          klpLinks: vocab?.klpLinks ?? [],
        })
      }
    }

    for (const attempt of practiceData?.attempts ?? []) {
      for (const item of parsePronunciationWeakWords(attempt.metricsJson)) {
        const key = normalizeWord(item.word)
        if (!key) continue
        const vocab = vocabByKey.get(key)
        const score = typeof item.accuracy === "number" ? item.accuracy / 100 : null
        const status = item.errorType && item.errorType !== "None"
          ? item.errorType
          : `Pronunciation ${Math.round(item.accuracy ?? 0)}%`
        const existing = words.get(key)
        if (existing) {
          words.set(key, {
            ...existing,
            source: mergeSource(existing.source, "pronunciation"),
            status: existing.source === "practice" ? existing.status : status,
            latestScore:
              existing.latestScore === null ? score :
              score === null ? existing.latestScore :
              Math.min(existing.latestScore, score),
            klpLinks: existing.klpLinks.length ? existing.klpLinks : vocab?.klpLinks ?? [],
          })
          continue
        }
        words.set(key, {
          key,
          word: vocab?.word ?? item.word,
          meaning: vocab?.arabicMeaning ?? null,
          vocabId: vocab?.id ?? null,
          source: "pronunciation",
          status,
          latestScore: score,
          bestScore: null,
          timesSpoken: 0,
          klpLinks: vocab?.klpLinks ?? [],
        })
      }
    }

    return Array.from(words.values()).sort((a, b) => {
      const aScore = a.latestScore ?? 1
      const bScore = b.latestScore ?? 1
      if (aScore !== bScore) return aScore - bScore
      return a.word.localeCompare(b.word)
    })
  }, [practiceData, wordLists, fluencySessions])

  const grouped = useMemo(() => {
    return weakWords.reduce<Record<string, WeakWord[]>>((acc, word) => {
      const label = severity(word)
      acc[label] ??= []
      acc[label].push(word)
      return acc
    }, {})
  }, [weakWords])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!practiceData?.cycle) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-foreground">Weak Words</h1>
        <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
          <BookOpen size={42} className="mx-auto text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">No active cycle. Ask your teacher to enroll you.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Target size={24} className="text-primary" />
            Weak Words
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Practice only the words that are not mastered yet. Mastered words are removed from this list.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{weakWords.length}</span> active word{weakWords.length === 1 ? "" : "s"}
        </div>
      </div>

      {weakWords.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
          <TrendingUp size={44} className="mx-auto text-emerald-400" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">No weak words right now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Keep practicing. Words will appear here when a score drops or a text practice list marks them for review.
          </p>
          <Link
            href="/practice"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start practice <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {["Needs repair", "Pronunciation", "Needs practice", "Developing", "From text practice"].map((groupName) => {
            const items = grouped[groupName] ?? []
            if (!items.length) return null
            return (
              <section key={groupName} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeClass(groupName)}`}>
                    {groupName}
                  </span>
                  <span className="text-xs text-muted-foreground">{items.length} word{items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((word) => (
                    <div key={word.key} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-foreground">{word.word}</h2>
                          {word.meaning && <p className="text-sm text-muted-foreground">{word.meaning}</p>}
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground">
                              {word.status}
                            </span>
                            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground">
                              Latest: {pct(word.latestScore)}
                            </span>
                            {word.source !== "practice" && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-300">
                                <FileText size={10} />
                                {sourceLabel(word.source)}
                              </span>
                            )}
                            {word.klpLinks.slice(0, 2).map((klp) => (
                              <span key={klp.id} className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-300">
                                {klp.book && klp.lesson ? `Book ${klp.book} Lesson ${klp.lesson}` : klp.conceptId}
                              </span>
                            ))}
                          </div>
                        </div>
                        {word.vocabId ? (
                          <Link
                            href={`/practice?stage=repeat&wordId=${word.vocabId}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                          >
                            <Mic size={13} />
                            Practice
                          </Link>
                        ) : (
                          <Link
                            href={word.source === "fluency" ? "/practice/fluency" : word.source === "pronunciation" ? "/practice/history" : "/practice/texts/lists"}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            <FileText size={13} />
                            {word.source === "pronunciation" ? "History" : "Text list"}
                          </Link>
                        )}
                      </div>

                      {word.vocabId && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/practice?stage=repeat&wordId=${word.vocabId}`} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                            Repeat
                          </Link>
                          <Link href={`/practice?stage=read-aloud&wordId=${word.vocabId}`} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                            Read aloud
                          </Link>
                          <Link href={`/practice?stage=sentence&wordId=${word.vocabId}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                            <MessageSquare size={12} />
                            Sentence
                          </Link>
                          <Link href={`/practice?stage=free-speak&wordId=${word.vocabId}`} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                            Free speak
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

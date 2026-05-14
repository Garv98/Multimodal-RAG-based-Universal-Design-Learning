"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Brain,
  BarChart,
  BookOpen,
  Download,
  Languages,
  Lightbulb,
  Layers,
  Sparkles,
  Loader2,
  RotateCw,
  Copy,
  Check,
  Volume2,
  VolumeX,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Library,
} from "lucide-react"
import {
  type Flashcard,
  type QuizDifficulty,
  type QuizQuestion,
  type StreamEvent,
  type SummaryLength,
  diagnoseMisconception,
  generateFlashcards,
  generateQuiz,
  streamSummary,
} from "@/lib/api"
import { RagChat } from "@/components/rag-chat"

type Props = {
  docId?: string | null
  docName?: string | null
}

export function StudyTools({ docId, docName }: Props) {
  const [active, setActive] = useState<"ask" | "summary" | "quiz" | "flashcards">("ask")

  return (
    <div className="space-y-4">
      <DocHeader docName={docName} docId={docId} />

      <Tabs value={active} onValueChange={(v) => setActive(v as typeof active)} className="w-full">
        <TabsList className="bg-card border border-border p-1 h-auto flex flex-wrap gap-1">
          <ToolTrigger value="ask" icon={Brain} label="Ask AI" accent="indigo" />
          <ToolTrigger value="summary" icon={BookOpen} label="Summary" accent="emerald" disabled={!docId} />
          <ToolTrigger value="quiz" icon={Lightbulb} label="Quiz me" accent="amber" disabled={!docId} />
          <ToolTrigger value="flashcards" icon={Layers} label="Flashcards" accent="rose" disabled={!docId} />
        </TabsList>

        <TabsContent value="ask" className="mt-4">
          <RagChat docId={docId ?? null} docName={docName ?? null} initialMode={docId ? "cag" : "rag"} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <SummaryPanel docId={docId} />
        </TabsContent>
        <TabsContent value="quiz" className="mt-4">
          <QuizPanel docId={docId} docName={docName} />
        </TabsContent>
        <TabsContent value="flashcards" className="mt-4">
          <FlashcardsPanel docId={docId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                    */
/* -------------------------------------------------------------------------- */

function DocHeader({ docName, docId }: { docName?: string | null; docId?: string | null }) {
  if (!docId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">No document attached.</strong> The Ask AI tab works in library mode.
        For Summary, Quiz, and Flashcards, open a document from the{" "}
        <Link href="/library" className="text-primary underline">library</Link>.
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <p className="truncate text-sm text-foreground">
          Studying: <span className="font-semibold">{docName || docId}</span>
        </p>
      </div>
      <Button variant="ghost" size="sm" asChild className="gap-2">
        <Link href="/library">
          <Library className="h-4 w-4" aria-hidden="true" />
          Switch
        </Link>
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Trigger                                                                   */
/* -------------------------------------------------------------------------- */

const ACCENT = {
  indigo: "data-[state=active]:bg-indigo-500/15 data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400",
  emerald: "data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400",
  amber: "data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-300",
  rose: "data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-600 dark:data-[state=active]:text-rose-400",
}

function ToolTrigger({
  value,
  icon: Icon,
  label,
  accent,
  disabled,
}: {
  value: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  accent: keyof typeof ACCENT
  disabled?: boolean
}) {
  return (
    <TabsTrigger
      value={value}
      disabled={disabled}
      className={`gap-2 px-3 py-2 transition-colors ${ACCENT[accent]}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  )
}

/* -------------------------------------------------------------------------- */
/*  Summary panel                                                             */
/* -------------------------------------------------------------------------- */

type LanguageInfo = { name: string; native_name: string; gtts_code: string }
type SummaryTranslation = { text: string; native_name: string; language_code: string; audio?: string }

function SummaryPanel({ docId }: { docId?: string | null }) {
  const [length, setLength] = useState<SummaryLength>("medium")
  const [text, setText] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [languages, setLanguages] = useState<Record<string, LanguageInfo>>({})
  const [languagesLoading, setLanguagesLoading] = useState(false)
  const [languagesError, setLanguagesError] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState("")
  const [translation, setTranslation] = useState<SummaryTranslation | null>(null)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [translationCopied, setTranslationCopied] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const loadLanguages = useCallback(async () => {
    setLanguagesLoading(true)
    setLanguagesError(null)
    try {
      const { getSupportedLanguages } = await import("@/lib/api")
      const res = await getSupportedLanguages()
      if (res.success && res.languages) {
        setLanguages(res.languages)
      } else {
        setLanguagesError("Could not load languages")
      }
    } catch (err) {
      setLanguagesError(String(err))
    } finally {
      setLanguagesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!text || languagesLoading || Object.keys(languages).length > 0) return
    loadLanguages()
  }, [text, languagesLoading, languages, loadLanguages])

  useEffect(() => {
    return () => {
      stopAudio()
    }
  }, [])

  function stopAudio() {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current = null
    setIsPlaying(false)
  }

  function toggleAudio() {
    if (!translation?.audio) return
    if (isPlaying) {
      stopAudio()
      return
    }

    stopAudio()
    const audio = new Audio(`data:audio/mp3;base64,${translation.audio}`)
    audioRef.current = audio
    audio.onended = () => {
      audioRef.current = null
      setIsPlaying(false)
    }
    audio.onerror = () => {
      audioRef.current = null
      setIsPlaying(false)
    }
    audio.play()
    setIsPlaying(true)
  }

  async function translateSummary(languageCode: string) {
    if (!text.trim() || !languageCode || translating) return
    setTranslating(true)
    setTranslation(null)
    setTranslationError(null)
    setTranslationCopied(false)
    stopAudio()
    try {
      const { translateToLanguage } = await import("@/lib/api")
      const res = await translateToLanguage(text, languageCode, true)
      if (res.success && res.result) {
        const result = res.result as { translations?: Record<string, SummaryTranslation> }
        const translations = result.translations || {}
        const match =
          Object.values(translations).find((t) => t.language_code === languageCode) ||
          Object.values(translations)[0]
        if (match) {
          setTranslation(match)
        } else {
          setTranslationError("No translation returned for that language")
        }
      } else {
        setTranslationError(res.error || "Translation failed")
      }
    } catch (err) {
      setTranslationError(String(err))
    } finally {
      setTranslating(false)
    }
  }

  function resetTranslationState() {
    setSelectedLanguage("")
    setTranslation(null)
    setTranslationError(null)
    setTranslationCopied(false)
    stopAudio()
  }

  async function go() {
    if (!docId || streaming) return
    setText("")
    setError(null)
    resetTranslationState()
    setStreaming(true)
    try {
      for await (const ev of streamSummary(docId, length) as AsyncGenerator<StreamEvent>) {
        if (ev.type === "token") setText((t) => t + ev.data)
        else if (ev.type === "done") {
          if (ev.data?.answer) setText((t) => (t.length >= ev.data.answer.length ? t : ev.data.answer))
        } else if (ev.type === "error") setError(ev.data)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setStreaming(false)
    }
  }

  async function doCopy() {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function copyTranslation() {
    if (!translation?.text) return
    await navigator.clipboard.writeText(translation.text)
    setTranslationCopied(true)
    setTimeout(() => setTranslationCopied(false), 1500)
  }

  const languageEntries = Object.entries(languages).sort((a, b) =>
    (a[1]?.name || "").localeCompare(b[1]?.name || "")
  )

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground mr-1">Length:</span>
          {(["short", "medium", "detailed"] as const).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={length === l ? "default" : "outline"}
              onClick={() => setLength(l)}
              disabled={streaming}
              className="capitalize"
            >
              {l}
            </Button>
          ))}
          <div className="ml-auto flex gap-2">
            {text && !streaming && (
              <Button size="sm" variant="outline" onClick={doCopy} className="gap-2">
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
            <Button size="sm" onClick={go} disabled={!docId || streaming} className="gap-2">
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BookOpen className="h-4 w-4" aria-hidden="true" />}
              {streaming ? "Streaming…" : text ? "Regenerate" : "Generate"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {(text || streaming) && (
          <article className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5 text-foreground">
            <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1.5 not-prose">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {length} summary
            </div>
            <div className="whitespace-pre-wrap text-[0.95rem] leading-relaxed">
              {text}
              {streaming && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-emerald-500 align-middle" />}
            </div>
          </article>
        )}

        {text && !streaming && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-primary" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-foreground">Translate this summary</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick a language to generate a translated version of the summary.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedLanguage}
                onChange={(e) => {
                  const code = e.target.value
                  setSelectedLanguage(code)
                  setTranslation(null)
                  setTranslationError(null)
                  setTranslationCopied(false)
                  if (code) translateSummary(code)
                }}
                disabled={languagesLoading || translating}
                className="h-9 min-w-56 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                aria-label="Select language for summary translation"
              >
                <option value="">Select a language</option>
                {languageEntries.map(([code, lang]) => (
                  <option key={code} value={code}>
                    {lang.name} ({lang.native_name})
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => translateSummary(selectedLanguage)}
                disabled={!selectedLanguage || translating || languagesLoading}
              >
                {translating ? "Translating…" : "Translate"}
              </Button>
              {languagesLoading && (
                <span className="text-xs text-muted-foreground">Loading languages…</span>
              )}
              {languagesError && (
                <Button size="sm" variant="ghost" onClick={loadLanguages}>
                  Retry languages
                </Button>
              )}
            </div>

            {languagesError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {languagesError}
              </div>
            )}

            {translationError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {translationError}
              </div>
            )}

            {translation && (
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Translation</p>
                    <p className="text-sm font-medium text-foreground">
                      {translation.native_name} ({translation.language_code})
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {translation.audio && (
                      <Button size="sm" variant="outline" onClick={toggleAudio} className="gap-2">
                        {isPlaying ? (
                          <VolumeX className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Volume2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        {isPlaying ? "Stop" : "Play"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={copyTranslation} className="gap-2">
                      {translationCopied ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      )}
                      {translationCopied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                  {translation.text}
                </p>
              </div>
            )}
          </div>
        )}

        {!text && !streaming && !error && (
          <p className="text-sm text-muted-foreground">
            Pick a length and hit Generate. The summary streams in token by token and is grounded in the full
            document — no hallucinations.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*  Quiz panel                                                                */
/* -------------------------------------------------------------------------- */

const QUIZ_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "about", "what", "when",
  "where", "which", "their", "there", "than", "then", "them", "these", "those", "over", "under",
  "have", "has", "had", "was", "were", "will", "would", "should", "could", "can", "may",
  "might", "not", "but", "you", "are", "our", "out", "how", "why", "who", "whom", "whose",
  "also", "more", "most", "less", "very", "much", "many", "some", "any", "each", "per",
  "use", "used", "using", "user", "users", "into", "via", "within", "between", "across",
])

type TopicCount = { term: string; count: number }

function extractKeywords(text: string, limit: number = 8): string[] {
  if (!text) return []
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 4 && !QUIZ_STOPWORDS.has(t))

  const counts: Record<string, number> = {}
  for (const token of tokens) counts[token] = (counts[token] || 0) + 1

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term)
}

function buildTopicCounts(texts: string[], limit: number = 6): TopicCount[] {
  const counts: Record<string, number> = {}
  for (const text of texts) {
    for (const keyword of extractKeywords(text, 10)) {
      counts[keyword] = (counts[keyword] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

function shortenWords(text: string, maxWords: number = 8): string {
  const parts = text.trim().split(/\s+/)
  if (parts.length <= maxWords) return text.trim()
  return `${parts.slice(0, maxWords).join(" ")}...`
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function safeFilePart(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  return cleaned.slice(0, 48) || "document"
}

type QuizReportRow = {
  index: number
  question: string
  picked: string
  correct: string
  status: "Correct" | "Incorrect" | "Unanswered"
  explanation: string
}

function buildQuizReportHtml(args: {
  title: string
  docLabel: string
  generatedAt: string
  difficulty: string
  nextDifficulty: string
  accuracy: number
  completion: number
  correctCount: number
  incorrectCount: number
  total: number
  elapsedLabel: string
  avgSpeedLabel: string
  focusTopics: TopicCount[]
  strengthTopics: TopicCount[]
  remediationText: string
  rows: QuizReportRow[]
}): string {
  const focusList = args.focusTopics.length
    ? args.focusTopics.map((t) => `<li>${escapeHtml(t.term)} <span class="pill">${t.count}</span></li>`).join("")
    : "<li>None yet</li>"

  const strengthList = args.strengthTopics.length
    ? args.strengthTopics.map((t) => `<li>${escapeHtml(t.term)} <span class="pill">${t.count}</span></li>`).join("")
    : "<li>None yet</li>"

  const rowsHtml = args.rows
    .map((row) => {
      const statusClass = row.status === "Correct" ? "status good" : row.status === "Incorrect" ? "status bad" : "status neutral"
      return `
        <tr>
          <td>${row.index}</td>
          <td>${escapeHtml(row.question)}</td>
          <td>${escapeHtml(row.picked)}</td>
          <td>${escapeHtml(row.correct)}</td>
          <td><span class="${statusClass}">${row.status}</span></td>
        </tr>
        <tr class="row-note">
          <td></td>
          <td colspan="4"><strong>Why:</strong> ${escapeHtml(row.explanation || "—")}</td>
        </tr>
      `
    })
    .join("")

  const remediation = args.remediationText
    ? `<pre>${escapeHtml(args.remediationText)}</pre>`
    : "<p>No weak areas detected yet. Great job.</p>"

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(args.title)}</title>
    <style>
      :root { --bg: #f6f7fb; --ink: #101827; --muted: #5f6b7b; --card: #ffffff; --line: #e5e7eb; --good: #10b981; --bad: #ef4444; --accent: #6366f1; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Trebuchet MS", "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
      header { padding: 32px; background: linear-gradient(120deg, #6366f1 0%, #22d3ee 100%); color: white; }
      header h1 { margin: 0 0 6px 0; font-size: 28px; }
      header p { margin: 0; opacity: 0.9; }
      main { padding: 24px; max-width: 1100px; margin: 0 auto; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.06); }
      .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
      .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
      .bar { margin-top: 10px; height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
      .bar > span { display: block; height: 100%; background: var(--accent); }
      .pill { margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #eef2ff; color: #3730a3; }
      ul { margin: 10px 0 0; padding-left: 18px; color: var(--muted); }
      pre { background: #111827; color: #f9fafb; padding: 16px; border-radius: 12px; overflow-wrap: break-word; white-space: pre-wrap; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
      th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
      th { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.08em; }
      .status { padding: 2px 10px; border-radius: 999px; font-size: 11px; display: inline-block; }
      .status.good { background: rgba(16, 185, 129, 0.15); color: #065f46; }
      .status.bad { background: rgba(239, 68, 68, 0.15); color: #7f1d1d; }
      .status.neutral { background: rgba(100, 116, 139, 0.15); color: #334155; }
      .row-note td { background: #f8fafc; color: var(--muted); font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(args.title)}</h1>
      <p>${escapeHtml(args.docLabel)} - Generated ${escapeHtml(args.generatedAt)}</p>
      <p>Difficulty: ${escapeHtml(args.difficulty)} | Next: ${escapeHtml(args.nextDifficulty)}</p>
    </header>
    <main>
      <section class="grid">
        <div class="card">
          <div class="label">Accuracy</div>
          <div class="value">${args.accuracy}%</div>
          <div class="bar"><span style="width:${args.accuracy}%"></span></div>
        </div>
        <div class="card">
          <div class="label">Completion</div>
          <div class="value">${args.completion}%</div>
          <div class="bar"><span style="width:${args.completion}%"></span></div>
        </div>
        <div class="card">
          <div class="label">Totals</div>
          <div class="value">${args.correctCount} / ${args.total}</div>
          <p>${args.incorrectCount} incorrect</p>
        </div>
        <div class="card">
          <div class="label">Time</div>
          <div class="value">${escapeHtml(args.elapsedLabel)}</div>
        </div>
        <div class="card">
          <div class="label">Avg speed</div>
          <div class="value">${escapeHtml(args.avgSpeedLabel)}</div>
        </div>
      </section>

      <section class="grid" style="margin-top:16px;">
        <div class="card">
          <div class="label">Focus areas</div>
          <ul>${focusList}</ul>
        </div>
        <div class="card">
          <div class="label">Strengths</div>
          <ul>${strengthList}</ul>
        </div>
      </section>

      <section class="card" style="margin-top:16px;">
        <div class="label">Remediation pack</div>
        ${remediation}
      </section>

      <section class="card" style="margin-top:16px;">
        <div class="label">Question breakdown</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Question</th>
              <th>Your answer</th>
              <th>Correct answer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`
}

const DIFFICULTY_STEPS: QuizDifficulty[] = ["easy", "medium", "hard"]

function shiftDifficulty(current: QuizDifficulty, delta: number): QuizDifficulty {
  const idx = DIFFICULTY_STEPS.indexOf(current)
  const next = Math.max(0, Math.min(DIFFICULTY_STEPS.length - 1, idx + delta))
  return DIFFICULTY_STEPS[next]
}

function computeAdaptiveDifficulty(
  current: QuizDifficulty,
  accuracy: number,
  avgSeconds: number,
): QuizDifficulty {
  if (avgSeconds <= 0) return current
  if (accuracy >= 85 && avgSeconds <= 25) return shiftDifficulty(current, 1)
  if (accuracy <= 55 || avgSeconds >= 60) return shiftDifficulty(current, -1)
  return current
}

type MisconceptionState = { loading: boolean; diagnosis?: string; micro_lesson?: string; error?: string }

function QuizPanel({ docId, docName }: { docId?: string | null; docName?: string | null }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<number, number>>({})
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [misconceptions, setMisconceptions] = useState<Record<number, MisconceptionState>>({})
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("medium")
  const [nextDifficulty, setNextDifficulty] = useState<QuizDifficulty>("medium")
  const [answerTimes, setAnswerTimes] = useState<Record<number, number>>({})
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [completedAt, setCompletedAt] = useState<number | null>(null)
  const [reviewSpeaking, setReviewSpeaking] = useState(false)

  function stopReviewAudio() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setReviewSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    setReviewSpeaking(false)
  }

  function toggleReviewAudio(text: string) {
    if (!text.trim()) return
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    if (reviewSpeaking) {
      stopReviewAudio()
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.95
    utterance.pitch = 1.0
    utterance.lang = "en-US"
    utterance.onend = () => setReviewSpeaking(false)
    utterance.onerror = () => setReviewSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setReviewSpeaking(true)
  }

  async function go() {
    if (!docId || loading) return
    setLoading(true)
    setError(null)
    setQuestions(null)
    setPicks({})
    setRevealed({})
    setMisconceptions({})
    setAnswerTimes({})
    setStartedAt(Date.now())
    setCompletedAt(null)
    stopReviewAudio()
    const activeDifficulty = nextDifficulty
    setDifficulty(activeDifficulty)
    setNextDifficulty(activeDifficulty)
    try {
      const res = await generateQuiz(docId, 5, activeDifficulty)
      if (res.success && res.questions) setQuestions(res.questions)
      else setError(res.error || "Quiz generation failed")
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function revealAnswer(qi: number) {
    setRevealed((r) => ({ ...r, [qi]: true }))
    if (!questions) return
    const q = questions[qi]
    const picked = picks[qi]
    if (picked === q.correct_index || picked === undefined) return
    // Wrong pick → ask Groq to diagnose the misconception
    setMisconceptions((m) => ({ ...m, [qi]: { loading: true } }))
    try {
      const res = await diagnoseMisconception({
        question: q.question,
        wrong_choice: q.options[picked] ?? "",
        correct_choice: q.options[q.correct_index] ?? "",
        doc_context: q.explanation,
      })
      setMisconceptions((m) => ({
        ...m,
        [qi]: res.success
          ? { loading: false, diagnosis: res.diagnosis, micro_lesson: res.micro_lesson }
          : { loading: false, error: res.error || "Failed to diagnose" },
      }))
    } catch (err) {
      setMisconceptions((m) => ({ ...m, [qi]: { loading: false, error: String(err) } }))
    }
  }

  function recordPick(qi: number, oi: number) {
    if (revealed[qi]) return
    setPicks((p) => ({ ...p, [qi]: oi }))
    setAnswerTimes((times) => {
      if (times[qi] !== undefined) return times
      const base = startedAt ?? Date.now()
      return { ...times, [qi]: Date.now() - base }
    })
  }

  const total = questions?.length ?? 0
  const correctCount = questions?.reduce((n, q, i) => n + (revealed[i] && picks[i] === q.correct_index ? 1 : 0), 0) ?? 0
  const revealedCount = Object.values(revealed).filter(Boolean).length
  const progress = total ? (revealedCount / total) * 100 : 0
  const incorrectCount = Math.max(0, revealedCount - correctCount)
  const accuracy = revealedCount ? Math.round((correctCount / revealedCount) * 100) : 0
  const completion = total ? Math.round((revealedCount / total) * 100) : 0
  const elapsedMs = startedAt ? (completedAt ?? Date.now()) - startedAt : 0
  const elapsedLabel = startedAt ? formatDuration(elapsedMs) : "Not started"
  const timeValues = Object.values(answerTimes)
  const avgMs = timeValues.length ? timeValues.reduce((sum, v) => sum + v, 0) / timeValues.length : 0
  const avgSeconds = avgMs ? Math.round(avgMs / 1000) : 0
  const avgSpeedLabel = avgSeconds ? `${avgSeconds}s avg` : "n/a"

  const questionResults = (questions || []).map((q, i) => {
    const pickedIndex = picks[i]
    const shown = !!revealed[i]
    const status: "Correct" | "Incorrect" | "Unanswered" = !shown
      ? "Unanswered"
      : pickedIndex === q.correct_index
        ? "Correct"
        : "Incorrect"
    const microLesson = misconceptions[i]?.micro_lesson
    const diagnosis = misconceptions[i]?.diagnosis
    const topicSource = `${q.question} ${q.explanation} ${microLesson || ""} ${diagnosis || ""}`
    return {
      index: i,
      question: q.question,
      explanation: q.explanation,
      picked: pickedIndex !== undefined ? q.options[pickedIndex] : "Not answered",
      correct: q.options[q.correct_index] || "",
      status,
      topicSource,
      microLesson,
      diagnosis,
    }
  })

  const wrongItems = questionResults.filter((r) => r.status === "Incorrect")
  const correctItems = questionResults.filter((r) => r.status === "Correct")
  const focusTopics = buildTopicCounts(wrongItems.map((r) => r.topicSource))
  const strengthTopics = buildTopicCounts(correctItems.map((r) => r.topicSource))
  const remediationItems = wrongItems.map((r, idx) => ({
    title: shortenWords(r.question),
    lesson: r.microLesson || r.diagnosis || r.explanation || "Review this concept again.",
    order: idx + 1,
  }))
  const remediationText = remediationItems
    .map((item) => `${item.order}. ${item.title}\n${item.lesson}`)
    .join("\n\n")

  const reportRows: QuizReportRow[] = questionResults.map((r) => ({
    index: r.index + 1,
    question: r.question,
    picked: r.picked,
    correct: r.correct,
    status: r.status,
    explanation: r.explanation,
  }))

  function downloadReport() {
    if (!questions || typeof window === "undefined") return
    const docLabel = docName || docId || "Document"
    const generatedAt = new Date().toLocaleString()
    const html = buildQuizReportHtml({
      title: "Quiz Report",
      docLabel,
      generatedAt,
      difficulty,
      nextDifficulty,
      accuracy,
      completion,
      correctCount,
      incorrectCount,
      total,
      elapsedLabel,
      avgSpeedLabel,
      focusTopics,
      strengthTopics,
      remediationText,
      rows: reportRows,
    })

    const blob = new Blob([html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const dateStamp = new Date().toISOString().slice(0, 10)
    const safeDoc = safeFilePart(docLabel)
    link.href = url
    link.download = `quiz-report-${safeDoc}-${dateStamp}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (!total || revealedCount < total) return
    if (completedAt === null) setCompletedAt(Date.now())
    const next = computeAdaptiveDifficulty(difficulty, accuracy, avgSeconds)
    setNextDifficulty(next)
  }, [total, revealedCount, completedAt, difficulty, accuracy, avgSeconds])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Active recall quiz</h3>
            <p className="text-xs text-muted-foreground">5 questions auto-generated from the document.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px]">Difficulty: {difficulty}</Badge>
              <Badge variant="secondary" className="text-[11px]">Next: {nextDifficulty}</Badge>
              {avgSeconds > 0 && (
                <Badge variant="outline" className="text-[11px]">Speed: {avgSpeedLabel}</Badge>
              )}
            </div>
          </div>
          <Button onClick={go} disabled={!docId || loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lightbulb className="h-4 w-4" aria-hidden="true" />}
            {loading ? "Generating…" : questions ? "New quiz" : "Generate quiz"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {questions && (
          <>
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
              <Progress value={progress} className="h-2 flex-1" />
              <span className="text-sm font-medium text-foreground">
                {correctCount} / {total} correct
              </span>
            </div>

            <div className="space-y-4">
              {questions.map((q, qi) => {
                const picked = picks[qi]
                const shown = !!revealed[qi]
                return (
                  <div key={qi} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-start gap-2 mb-3">
                      <Badge variant="outline" className="font-mono text-xs">Q{qi + 1}</Badge>
                      <p className="font-medium text-foreground">{q.question}</p>
                    </div>
                    <ul className="space-y-2">
                      {q.options.map((opt, oi) => {
                        const isPicked = picked === oi
                        const isCorrect = q.correct_index === oi
                        let cls = "border-border bg-card hover:bg-muted/50"
                        if (shown && isCorrect) cls = "border-emerald-500/60 bg-emerald-500/10"
                        else if (shown && isPicked && !isCorrect) cls = "border-destructive/60 bg-destructive/10"
                        else if (isPicked) cls = "border-amber-500/60 bg-amber-500/10"
                        return (
                          <li key={oi}>
                            <button
                              onClick={() => !shown && recordPick(qi, oi)}
                              disabled={shown}
                              className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors flex items-center gap-2 ${cls}`}
                            >
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-semibold shrink-0">
                                {String.fromCharCode(65 + oi)}
                              </span>
                              <span className="flex-1">{opt}</span>
                              {shown && isCorrect && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                              {shown && isPicked && !isCorrect && <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    <div className="mt-3 flex items-center gap-2">
                      {!shown ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => revealAnswer(qi)}
                          disabled={picked === undefined}
                        >
                          Reveal answer
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          <strong className="not-italic text-foreground">Why:</strong> {q.explanation}
                        </p>
                      )}
                    </div>

                    {/* Misconception micro-lesson (fires on wrong reveal) */}
                    {shown && picked !== undefined && picked !== q.correct_index && misconceptions[qi] && (
                      <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-start gap-2">
                          <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
                          <div className="flex-1 text-sm text-foreground">
                            {misconceptions[qi].loading ? (
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                Diagnosing the misconception…
                              </span>
                            ) : misconceptions[qi].error ? (
                              <span className="text-destructive">{misconceptions[qi].error}</span>
                            ) : (
                              <>
                                {misconceptions[qi].diagnosis && (
                                  <p>
                                    <strong className="text-amber-700 dark:text-amber-300">Diagnosis:</strong>{" "}
                                    {misconceptions[qi].diagnosis}
                                  </p>
                                )}
                                {misconceptions[qi].micro_lesson && (
                                  <p className="mt-1">
                                    <strong className="text-amber-700 dark:text-amber-300">Quick fix:</strong>{" "}
                                    {misconceptions[qi].micro_lesson}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {revealedCount > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BarChart className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h4 className="text-sm font-semibold text-foreground">Quiz report</h4>
                  </div>
                  <Button size="sm" variant="outline" onClick={downloadReport} className="gap-2">
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download report
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                    <p className="text-lg font-semibold text-foreground">{accuracy}%</p>
                    <Progress value={accuracy} className="h-2 mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {correctCount} correct, {incorrectCount} incorrect
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Completion</p>
                    <p className="text-lg font-semibold text-foreground">{completion}%</p>
                    <Progress value={completion} className="h-2 mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {revealedCount} / {total} revealed
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Time</p>
                    <p className="text-lg font-semibold text-foreground">{elapsedLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {completedAt ? "Quiz complete" : "In progress"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Focus areas</p>
                    {focusTopics.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {focusTopics.map((t) => (
                          <Badge key={t.term} variant="secondary" className="text-[11px]">
                            {t.term} · {t.count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No weak topics yet.</p>
                    )}
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Strengths</p>
                    {strengthTopics.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {strengthTopics.map((t) => (
                          <Badge key={t.term} variant="outline" className="text-[11px]">
                            {t.term} · {t.count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Reveal answers to see strengths.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Recovery lesson</p>
                      <p className="text-sm font-medium text-foreground">Personalized review pack</p>
                    </div>
                    {remediationText && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleReviewAudio(remediationText)}
                        className="gap-2"
                      >
                        {reviewSpeaking ? (
                          <VolumeX className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Volume2 className="h-4 w-4" aria-hidden="true" />
                        )}
                        {reviewSpeaking ? "Stop" : "Listen"}
                      </Button>
                    )}
                  </div>
                  {remediationText ? (
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm text-foreground">
                      {remediationText}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Answer questions and reveal explanations to generate a personalized review pack.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!questions && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            Generate a 5-question quiz on the active document. Pick an answer, reveal the explanation, and track
            your score.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*  Flashcards panel                                                          */
/* -------------------------------------------------------------------------- */

function FlashcardsPanel({ docId }: { docId?: string | null }) {
  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  async function go() {
    if (!docId || loading) return
    setLoading(true)
    setError(null)
    setCards(null)
    setIndex(0)
    setFlipped(false)
    try {
      const res = await generateFlashcards(docId, 8)
      if (res.success && res.cards) setCards(res.cards)
      else setError(res.error || "Flashcard generation failed")
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    if (!cards) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        setIndex((i) => Math.min((cards?.length ?? 1) - 1, i + 1))
        setFlipped(false)
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1))
        setFlipped(false)
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        setFlipped((f) => !f)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [cards])

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Flashcards</h3>
            <p className="text-xs text-muted-foreground">
              Tap a card to flip. Use ← / → to navigate, Space to flip.
            </p>
          </div>
          <Button onClick={go} disabled={!docId || loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Layers className="h-4 w-4" aria-hidden="true" />}
            {loading ? "Generating…" : cards ? "New deck" : "Generate flashcards"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {cards && cards.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Card <strong className="text-foreground">{index + 1}</strong> of {cards.length}
              </span>
              <span>{flipped ? "Showing back" : "Showing front"}</span>
            </div>

            <div className="[perspective:1200px]">
              <button
                onClick={() => setFlipped((f) => !f)}
                className="block w-full text-left"
                aria-label="Flip card"
              >
                <div
                  className={`relative h-64 w-full transition-transform duration-500 [transform-style:preserve-3d] ${
                    flipped ? "[transform:rotateY(180deg)]" : ""
                  }`}
                >
                  {/* Front */}
                  <div className="absolute inset-0 rounded-xl border-2 border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent p-6 flex flex-col [backface-visibility:hidden]">
                    <Badge variant="outline" className="self-start text-[10px] uppercase tracking-wide">Front</Badge>
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-xl font-semibold text-foreground text-center leading-snug">
                        {cards[index].front}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">Click to reveal answer</p>
                  </div>
                  {/* Back */}
                  <div className="absolute inset-0 rounded-xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-6 flex flex-col [transform:rotateY(180deg)] [backface-visibility:hidden]">
                    <Badge variant="outline" className="self-start text-[10px] uppercase tracking-wide">Back</Badge>
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-base text-foreground text-center leading-relaxed">
                        {cards[index].back}
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIndex((i) => Math.max(0, i - 1))
                  setFlipped(false)
                }}
                disabled={index === 0}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFlipped((f) => !f)}
                className="gap-2"
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" /> Flip
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIndex((i) => Math.min(cards.length - 1, i + 1))
                  setFlipped(false)
                }}
                disabled={index >= cards.length - 1}
                className="gap-2"
              >
                Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {!cards && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            Generate up to 8 term/definition flashcards from this document for spaced-repetition study.
          </p>
        )}
      </CardContent>
    </Card>
  )
}


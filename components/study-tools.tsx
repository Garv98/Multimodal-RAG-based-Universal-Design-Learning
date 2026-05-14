"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Brain,
  BookOpen,
  Lightbulb,
  Layers,
  Sparkles,
  Loader2,
  RotateCw,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Library,
} from "lucide-react"
import {
  type Flashcard,
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
          <QuizPanel docId={docId} />
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

function SummaryPanel({ docId }: { docId?: string | null }) {
  const [length, setLength] = useState<SummaryLength>("medium")
  const [text, setText] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function go() {
    if (!docId || streaming) return
    setText("")
    setError(null)
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

type MisconceptionState = { loading: boolean; diagnosis?: string; micro_lesson?: string; error?: string }

function QuizPanel({ docId }: { docId?: string | null }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<number, number>>({})
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [misconceptions, setMisconceptions] = useState<Record<number, MisconceptionState>>({})

  async function go() {
    if (!docId || loading) return
    setLoading(true)
    setError(null)
    setQuestions(null)
    setPicks({})
    setRevealed({})
    setMisconceptions({})
    try {
      const res = await generateQuiz(docId, 5)
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

  const total = questions?.length ?? 0
  const correctCount = questions?.reduce((n, q, i) => n + (revealed[i] && picks[i] === q.correct_index ? 1 : 0), 0) ?? 0
  const revealedCount = Object.values(revealed).filter(Boolean).length
  const progress = total ? (revealedCount / total) * 100 : 0

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Active recall quiz</h3>
            <p className="text-xs text-muted-foreground">5 questions auto-generated from the document.</p>
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
                              onClick={() => !shown && setPicks((p) => ({ ...p, [qi]: oi }))}
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


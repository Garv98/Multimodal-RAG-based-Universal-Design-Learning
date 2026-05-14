"use client"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import {
  Brain,
  FileText,
  Library,
  Loader2,
  Mic,
  MicOff,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react"
import {
  type Citation,
  type GenerationMode,
  type UdlCheckReport,
  runUdlCheck,
  streamGenerate,
} from "@/lib/api"

type Props = {
  /** Document to scope CAG mode to. When undefined, only RAG mode is available. */
  docId?: string | null
  docName?: string | null
  initialMode?: GenerationMode
}

export function RagChat({ docId, docName, initialMode }: Props) {
  const resolvedInitialMode: GenerationMode = initialMode ?? (docId ? "cag" : "rag")
  const [mode, setMode] = useState<GenerationMode>(resolvedInitialMode)
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState("")
  const [citations, setCitations] = useState<Citation[]>([])
  const [effectiveMode, setEffectiveMode] = useState<GenerationMode | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [udlReport, setUdlReport] = useState<UdlCheckReport | null>(null)
  const [udlLoading, setUdlLoading] = useState(false)

  const answerEndRef = useRef<HTMLDivElement | null>(null)

  // ── Voice Q&A (Web Speech API: STT + TTS) ─────────────────────────────
  const [listening, setListening] = useState(false)
  const [speakOnDone, setSpeakOnDone] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    setVoiceSupported(true)
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = "en-US"
    rec.onresult = (event: any) => {
      let transcript = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setQuery(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    return () => {
      try { rec.stop() } catch {}
    }
  }, [])

  function toggleListening() {
    const rec = recognitionRef.current
    if (!rec) return
    if (listening) {
      try { rec.stop() } catch {}
      setListening(false)
    } else {
      setQuery("")
      try {
        rec.start()
        setListening(true)
      } catch {
        setListening(false)
      }
    }
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.0
    utter.pitch = 1.0
    utter.lang = "en-US"
    window.speechSynthesis.speak(utter)
  }

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel()
    }
  }

  // Keep CAG selectable only when a doc is attached
  useEffect(() => {
    if (!docId && mode === "cag") setMode("rag")
  }, [docId, mode])

  useEffect(() => {
    if (streaming) answerEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [answer, streaming])

  async function handleSubmit() {
    if (!query.trim() || streaming) return
    setAnswer("")
    setCitations([])
    setEffectiveMode(null)
    setFallbackReason(null)
    setError(null)
    setUdlReport(null)
    setStreaming(true)

    try {
      const stream = streamGenerate(mode, query, docId ?? undefined)
      for await (const event of stream) {
        if (event.type === "token") {
          setAnswer((a) => a + event.data)
        } else if (event.type === "citations") {
          setCitations(event.data)
        } else if (event.type === "mode") {
          setEffectiveMode(event.data.effective_mode)
          if (event.data.fallback_reason) setFallbackReason(event.data.fallback_reason)
        } else if (event.type === "done") {
          // Trust the streamed answer; the `done` event mostly confirms completion.
          const finalAnswer = event.data?.answer || ""
          if (finalAnswer.length > 0) {
            setAnswer((a) => (a.length >= finalAnswer.length ? a : finalAnswer))
          }
          if (speakOnDone && finalAnswer) speak(finalAnswer)
        } else if (event.type === "error") {
          setError(event.data)
        }
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setStreaming(false)
    }
  }

  async function handleUdlCheck() {
    if (!answer.trim() || udlLoading) return
    setUdlLoading(true)
    setUdlReport(null)
    try {
      const res = await runUdlCheck(answer)
      if (res.success && res.report) setUdlReport(res.report)
      else setError(res.error || "UDL check failed")
    } catch (err) {
      setError(String(err))
    } finally {
      setUdlLoading(false)
    }
  }

  const canUseCag = !!docId

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Brain className="h-5 w-5 text-primary" aria-hidden="true" />
          Ask AI
          {effectiveMode && effectiveMode !== mode && (
            <Badge variant="secondary" className="ml-1 text-xs">
              auto: {effectiveMode.toUpperCase()}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {canUseCag
            ? "Ask about the current document, or switch to library-wide search."
            : "Search across every document in your library."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {canUseCag && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "cag" ? "default" : "outline"}
              onClick={() => setMode("cag")}
              className="gap-2"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">This document</span>
              <span className="sm:hidden">CAG</span>
            </Button>
            <Button
              size="sm"
              variant={mode === "rag" ? "default" : "outline"}
              onClick={() => setMode("rag")}
              className="gap-2"
            >
              <Library className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">My library</span>
              <span className="sm:hidden">RAG</span>
            </Button>
            {docName && (
              <span className="ml-2 self-center text-xs text-muted-foreground truncate max-w-[14rem]">
                {mode === "cag" ? `Scoped to: ${docName}` : "Searching all your documents"}
              </span>
            )}
          </div>
        )}

        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === "cag"
              ? "Ask anything about this document…"
              : "Ask anything about your indexed documents…"
          }
          rows={3}
          disabled={streaming}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              handleSubmit()
            }
          }}
          className="resize-none"
          aria-label="Question for the AI assistant"
        />

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</p>
            {voiceSupported && (
              <Button
                size="sm"
                variant={speakOnDone ? "default" : "outline"}
                onClick={() => {
                  const next = !speakOnDone
                  setSpeakOnDone(next)
                  if (!next) stopSpeaking()
                }}
                title={speakOnDone ? "Disable read-aloud" : "Read answer aloud when done"}
                className="gap-1.5 h-8"
              >
                {speakOnDone ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="text-xs">Read aloud</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {voiceSupported && (
              <Button
                size="sm"
                variant={listening ? "destructive" : "outline"}
                onClick={toggleListening}
                disabled={streaming}
                title={listening ? "Stop listening" : "Ask by voice"}
                className="gap-1.5"
              >
                {listening ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                <span className="hidden sm:inline">{listening ? "Listening…" : "Voice"}</span>
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={!query.trim() || streaming} className="gap-2">
              {streaming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Streaming…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>

        {fallbackReason && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            <strong className="font-semibold">Mode auto-switched:</strong> {fallbackReason}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <strong className="font-semibold">Error:</strong> {error}
          </div>
        )}

        {(answer || streaming) && (
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Answer
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {answer}
              {streaming && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />}
            </div>
            <div ref={answerEndRef} />
          </div>
        )}

        {citations.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-foreground">Sources</h4>
            <ul className="space-y-2">
              {citations.map((c, i) => (
                <li
                  key={`${c.doc_id}-${c.chunk_index}`}
                  className="rounded-md border border-border bg-background p-3 text-sm"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      Source {i + 1}
                    </Badge>
                    <span className="truncate font-medium text-foreground">{c.doc_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      score {c.score.toFixed(3)}
                      {c.page != null && ` · page ${c.page}`}
                      {c.timestamp != null && ` · ${formatTime(c.timestamp)}`}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{c.text_preview}…</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {answer && !streaming && (
          <div className="border-t border-border pt-4">
            <Button onClick={handleUdlCheck} variant="outline" size="sm" disabled={udlLoading} className="gap-2">
              {udlLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden="true" />
              )}
              Run UDL check on this answer
            </Button>

            {udlReport && <UdlReportPanel report={udlReport} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UdlReportPanel({ report }: { report: UdlCheckReport }) {
  const biasScore = Math.round(report.bias.bias_score ?? 0)
  const biased = report.bias.overall_bias_detected || (report.bias.flags?.length ?? 0) > 0

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <h5 className="font-semibold text-foreground">Simplified rewrite</h5>
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {report.simplification.simplified || "—"}
        </p>
        {typeof report.simplification.readability_improvement === "number" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Readability lift: {report.simplification.readability_improvement.toFixed(1)}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert
              className={`h-4 w-4 ${biased ? "text-destructive" : "text-primary"}`}
              aria-hidden="true"
            />
            <h5 className="font-semibold text-foreground">Bias check</h5>
          </div>
          <Badge variant={biased ? "destructive" : "secondary"} className="text-xs">
            {biased ? "Flags found" : "No bias detected"}
          </Badge>
        </div>
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Bias-free score</span>
          <span className="font-semibold">{biasScore}/100</span>
        </div>
        <Progress value={biasScore} className="h-2" />
        {report.bias.flags && report.bias.flags.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-foreground">
            {report.bias.flags.slice(0, 4).map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{f.type}</Badge>
                <span className="truncate">{f.matched_text || "—"}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">{f.severity}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

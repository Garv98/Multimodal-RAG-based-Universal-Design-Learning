"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  FileText,
  ImageIcon,
  Mic,
  FileIcon,
  Video,
  Upload,
  X,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react"
import { toast } from "sonner"

/* ──────────────────────────────────────────────────────────────────────────
 * Smart upload form
 *
 * One universal drop zone replaces the old 4-tab picker. We auto-detect the
 * input modality from MIME type + file extension and route to the right
 * processing path:
 *
 *   image  → udl-image-file  (image_captioning + alt-text + OCR)
 *   pdf    → udl-pdf-file    (pdfplumber/PyPDF2)
 *   audio  → udl-audio-file  (AssemblyAI transcription)
 *   video  → redirect to /video (the dedicated video pipeline)
 *   text   → read into the text area (or pasted directly)
 *
 * Text files (.txt / .md / .rtf / .csv) are read inline into the text area
 * so the user can edit before processing.
 * ────────────────────────────────────────────────────────────────────────── */

type DetectedKind = "text" | "image" | "audio" | "pdf" | "video"
type DetectionResult =
  | { kind: DetectedKind; label: string; subLabel: string }
  | { kind: "unsupported"; reason: string }

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "tif", "tiff"]
const PDF_EXTS = ["pdf"]
const AUDIO_EXTS = ["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus", "wma"]
const VIDEO_EXTS = ["mp4", "mov", "avi", "webm", "mkv", "m4v", "wmv", "flv", "3gp"]
const TEXT_EXTS = ["txt", "md", "markdown", "rtf", "csv", "log"]

function detectFileType(file: File): DetectionResult {
  const mime = (file.type || "").toLowerCase()
  const ext = file.name.split(".").pop()?.toLowerCase() || ""
  const fmt = ext ? `${ext.toUpperCase()} · ${formatBytes(file.size)}` : formatBytes(file.size)

  if (mime.startsWith("image/") || IMAGE_EXTS.includes(ext)) return { kind: "image", label: "Image", subLabel: fmt }
  if (mime === "application/pdf" || PDF_EXTS.includes(ext))   return { kind: "pdf",   label: "PDF document", subLabel: fmt }
  if (mime.startsWith("audio/") || AUDIO_EXTS.includes(ext)) return { kind: "audio", label: "Audio", subLabel: fmt }
  if (mime.startsWith("video/") || VIDEO_EXTS.includes(ext)) return { kind: "video", label: "Video", subLabel: fmt }
  if (mime.startsWith("text/") || TEXT_EXTS.includes(ext))   return { kind: "text",  label: "Text file", subLabel: fmt }
  return { kind: "unsupported", reason: `Cannot handle "${ext || mime || "this file"}". Supported: images, PDFs, audio, video, plain text.` }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const KIND_META: Record<DetectedKind, { icon: React.ComponentType<{ className?: string }>; tone: string; tint: string; ring: string }> = {
  image: { icon: ImageIcon, tone: "text-rose-700 dark:text-rose-300",    tint: "bg-rose-500/10 border-rose-500/30",       ring: "ring-rose-500/30" },
  pdf:   { icon: FileIcon,  tone: "text-indigo-700 dark:text-indigo-300", tint: "bg-indigo-500/10 border-indigo-500/30", ring: "ring-indigo-500/30" },
  audio: { icon: Mic,       tone: "text-amber-700 dark:text-amber-300",  tint: "bg-amber-500/10 border-amber-500/30",   ring: "ring-amber-500/30" },
  video: { icon: Video,     tone: "text-sky-700 dark:text-sky-300",      tint: "bg-sky-500/10 border-sky-500/30",       ring: "ring-sky-500/30" },
  text:  { icon: FileText,  tone: "text-emerald-700 dark:text-emerald-300", tint: "bg-emerald-500/10 border-emerald-500/30", ring: "ring-emerald-500/30" },
}

export function UploadForm() {
  const router = useRouter()
  const [textInput, setTextInput] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [detectedKind, setDetectedKind] = useState<DetectedKind | null>(null)
  const [detectionLabel, setDetectionLabel] = useState<string>("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear stale session data on mount (fresh upload session)
  useEffect(() => {
    sessionStorage.removeItem("udl-image-file")
    sessionStorage.removeItem("udl-audio-file")
    sessionStorage.removeItem("udl-pdf-file")
    sessionStorage.removeItem("udl-text-content")
    sessionStorage.removeItem("udl-results")
    sessionStorage.removeItem("udl-current-doc-id")
    sessionStorage.removeItem("udl-current-doc-name")
  }, [])

  // Auto-save text draft every 5s
  useEffect(() => {
    const timer = setInterval(() => {
      if (textInput.trim()) sessionStorage.setItem("udl-draft", textInput)
    }, 5000)
    return () => clearInterval(timer)
  }, [textInput])

  // Load draft on mount
  useEffect(() => {
    const draft = sessionStorage.getItem("udl-draft")
    if (draft && !textInput) setTextInput(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function acceptFile(selected: File) {
    const result = detectFileType(selected)
    if (result.kind === "unsupported") {
      toast.error("Unsupported file", { description: result.reason })
      return
    }
    if (result.kind === "video") {
      toast.message("Video detected", {
        description: "Video uploads have their own dedicated pipeline. Redirecting…",
      })
      // Park the file in a global cache and send the user to /video
      if (typeof window !== "undefined") {
        ;(window as any).__udl_files = { ...(window as any).__udl_files, video: selected }
      }
      router.push("/video")
      return
    }
    if (result.kind === "text") {
      // Read text-file contents straight into the textarea — no need to
      // treat it as a file upload.
      const reader = new FileReader()
      reader.onload = () => {
        const content = String(reader.result || "")
        setTextInput(content)
        setFile(null)
        setDetectedKind("text")
        setDetectionLabel(`${result.label} · ${result.subLabel}`)
        toast.success("Text imported", {
          description: `${selected.name} loaded into the text area (${content.length.toLocaleString()} chars).`,
        })
      }
      reader.onerror = () => toast.error("Could not read text file")
      reader.readAsText(selected)
      return
    }
    setFile(selected)
    setDetectedKind(result.kind)
    setDetectionLabel(`${result.label} · ${result.subLabel}`)
    toast.success(`Detected: ${result.label}`, { description: selected.name })
  }

  function clearFile() {
    setFile(null)
    setDetectedKind(textInput.trim() ? "text" : null)
    setDetectionLabel("")
    if (inputRef.current) inputRef.current.value = ""
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) acceptFile(dropped)
  }
  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) acceptFile(selected)
  }

  async function handleSubmit() {
    setIsProcessing(true)

    // Clear previous file slots so the right one is set fresh
    sessionStorage.removeItem("udl-image-file")
    sessionStorage.removeItem("udl-audio-file")
    sessionStorage.removeItem("udl-pdf-file")
    sessionStorage.removeItem("udl-results")
    sessionStorage.setItem("udl-text-content", textInput)

    // Route the file to the correct sessionStorage slot based on detection
    if (file && detectedKind) {
      const slotKey =
        detectedKind === "image" ? "udl-image-file" :
        detectedKind === "pdf"   ? "udl-pdf-file"   :
        detectedKind === "audio" ? "udl-audio-file" : null

      if (slotKey) {
        if (detectedKind !== "audio" && file.size < 1024 * 1024) {
          // Inline small files as base64 so they survive a reload
          const data = await fileToBase64(file)
          sessionStorage.setItem(
            slotKey,
            JSON.stringify({ name: file.name, data, type: file.type }),
          )
        } else {
          // Large files: store metadata only; the real File object lives in
          // window.__udl_files and the processing page reads it from there.
          sessionStorage.setItem(
            slotKey,
            JSON.stringify({ name: file.name, type: file.type, size: file.size, isLarge: true }),
          )
        }
      }
    }

    // Keep raw File handles in a window cache for the pipeline page
    if (typeof window !== "undefined") {
      (window as any).__udl_files = {
        image: detectedKind === "image" ? file : null,
        audio: detectedKind === "audio" ? file : null,
        pdf:   detectedKind === "pdf"   ? file : null,
      }
    }

    router.push("/processing")
  }

  const hasContent = !!textInput.trim() || !!file

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          Smart upload
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Drop any file or paste text — NovaPulse detects the input type and routes it through the right pipeline automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Drop zone OR file preview */}
        {file && detectedKind && detectedKind !== "text" ? (
          <FilePreview
            file={file}
            kind={detectedKind}
            label={detectionLabel}
            onClear={clearFile}
          />
        ) : (
          <DropZone
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
            }}
          />
        )}

        <input
          ref={inputRef}
          type="file"
          onChange={handleSelect}
          className="sr-only"
          accept="image/*,application/pdf,audio/*,video/*,text/plain,text/markdown,.txt,.md,.csv,.rtf"
          aria-hidden="true"
        />

        {/* Supported-types legend */}
        {!file && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <SupportPill icon={ImageIcon} label="Image" tone="rose" />
            <SupportPill icon={FileIcon}  label="PDF"   tone="indigo" />
            <SupportPill icon={Mic}       label="Audio" tone="amber" />
            <SupportPill icon={Video}     label="Video" tone="sky" subLabel="→ /video" />
            <SupportPill icon={FileText}  label="Text"  tone="emerald" />
          </div>
        )}

        {/* Text input — always available; complementary to file upload */}
        <div className="space-y-2">
          <label htmlFor="text-input" className="text-sm font-medium text-foreground flex items-center justify-between">
            <span>Or paste / type text</span>
            {textInput.trim() && (
              <Badge variant="outline" className="text-[10px] gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {textInput.trim().split(/\s+/).length.toLocaleString()} words
              </Badge>
            )}
          </label>
          <Textarea
            id="text-input"
            placeholder="Paste an article, a passage of text, or any content you want processed for accessibility…"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            className="min-h-45 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Submit */}
        <div className="pt-2 border-t border-border">
          <Button
            size="lg"
            className="w-full gap-2 shadow-lg shadow-primary/10"
            disabled={!hasContent || isProcessing}
            onClick={handleSubmit}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Processing…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Process content
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
          {!hasContent && (
            <p className="mt-2 text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Drop a file or paste text to enable processing.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*  Drop zone                                                                 */
/* -------------------------------------------------------------------------- */

function DropZone({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onKeyDown,
}: {
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label="Drop any file here or click to browse"
      className={`relative isolate overflow-hidden rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all duration-200
        ${isDragging
          ? "border-primary bg-primary/10 ring-4 ring-primary/20 scale-[1.01]"
          : "border-border hover:border-primary/60 hover:bg-muted/30"}`}
    >
      <div
        className="absolute inset-0 -z-10 bg-linear-to-br from-primary/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      />
      <div className={`mx-auto h-14 w-14 rounded-2xl flex items-center justify-center mb-4 transition-all ${
        isDragging ? "bg-primary/20 scale-110" : "bg-primary/10"
      }`}>
        <Upload className={`h-7 w-7 transition-colors ${isDragging ? "text-primary" : "text-primary/80"}`} aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">
        {isDragging ? "Release to detect" : "Drop any file here"}
      </h3>
      <p className="text-sm text-muted-foreground">
        or <span className="text-primary font-medium underline-offset-2 hover:underline">browse your computer</span>
      </p>
      <p className="text-xs text-muted-foreground mt-3">
        We&apos;ll detect images, PDFs, audio, video, and text automatically.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Detected-file preview                                                     */
/* -------------------------------------------------------------------------- */

function FilePreview({
  file,
  kind,
  label,
  onClear,
}: {
  file: File
  kind: DetectedKind
  label: string
  onClear: () => void
}) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return (
    <div className={`rounded-xl border-2 p-5 ring-2 ${meta.tint} ${meta.ring}`}>
      <div className="flex items-center gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-background/60 ${meta.tone}`}>
          <Icon className="h-7 w-7" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className={`text-xs uppercase tracking-wide font-semibold ${meta.tone} bg-background/60`}>
              <Sparkles className="h-3 w-3 mr-1" aria-hidden="true" />
              Detected · {label}
            </Badge>
          </div>
          <p className="font-semibold text-foreground truncate" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Routing to the <strong className="text-foreground">{kind}</strong> pipeline on Process.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClear} aria-label={`Remove ${file.name}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {kind === "video" && (
        <p className="mt-3 text-xs text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          Video uses the dedicated pipeline at{" "}
          <Link href="/video" className="underline font-medium">
            /video
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Supported-type pill (legend)                                              */
/* -------------------------------------------------------------------------- */

function SupportPill({
  icon: Icon,
  label,
  tone,
  subLabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: "rose" | "indigo" | "amber" | "sky" | "emerald"
  subLabel?: string
}) {
  const toneClasses = {
    rose:    "border-rose-500/30 text-rose-700 dark:text-rose-300",
    indigo:  "border-indigo-500/30 text-indigo-700 dark:text-indigo-300",
    amber:   "border-amber-500/30 text-amber-700 dark:text-amber-300",
    sky:     "border-sky-500/30 text-sky-700 dark:text-sky-300",
    emerald: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  }[tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-card/50 ${toneClasses}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="font-medium">{label}</span>
      {subLabel && <span className="text-[10px] text-muted-foreground">{subLabel}</span>}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = (error) => reject(error)
  })
}

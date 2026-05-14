"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  FileText,
  FileImage,
  Mic,
  Video,
  Trash2,
  Loader2,
  MessageCircle,
} from "lucide-react"
import { type LibraryDocument, deleteDocument, listLibrary } from "@/lib/api"
import { toast } from "sonner"

type Props = {
  selectedDocId: string | null
  onSelect: (doc: LibraryDocument | null) => void
  refreshKey?: number
}

const MODALITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  text: FileText,
  image: FileImage,
  audio: Mic,
  video: Video,
}

export function LibraryList({ selectedDocId, onSelect, refreshKey }: Props) {
  const [docs, setDocs] = useState<LibraryDocument[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await listLibrary()
      if (res.success) {
        setDocs(res.documents)
      } else {
        setError(res.error || "Could not load library")
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [refreshKey])

  async function handleDelete(doc: LibraryDocument) {
    if (!confirm(`Delete "${doc.name}" from your library?`)) return
    setDeletingId(doc.id)
    try {
      const res = await deleteDocument(doc.id)
      if (res.success) {
        toast.success(`Removed "${doc.name}"`)
        if (selectedDocId === doc.id) onSelect(null)
        refresh()
      } else {
        toast.error(res.error || "Delete failed")
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground">Your library</CardTitle>
        <CardDescription>
          Documents you have processed. Select one to ask questions scoped to it (CAG), or stay in library-wide mode (RAG).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && docs && docs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload one from the home page and the processing pipeline will add it here.
          </p>
        )}

        {docs && docs.length > 0 && (
          <ul className="divide-y divide-border">
            {docs.map((doc) => {
              const Icon = MODALITY_ICONS[doc.modality] || FileText
              const isSelected = doc.id === selectedDocId
              return (
                <li key={doc.id} className="flex items-center gap-3 py-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-md ${
                      isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.total_chunks} chunks ·{" "}
                      <Badge variant="outline" className="text-[10px]">
                        {doc.modality}
                      </Badge>{" "}
                      · {new Date(doc.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    onClick={() => onSelect(isSelected ? null : doc)}
                    className="gap-2"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{isSelected ? "Open" : "Ask"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    aria-label={`Delete ${doc.name}`}
                  >
                    {deletingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

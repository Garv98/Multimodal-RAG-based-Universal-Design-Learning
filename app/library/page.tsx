"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"
import { LibraryList } from "@/components/library-list"
import { RagChat } from "@/components/rag-chat"
import { type LibraryDocument } from "@/lib/api"
import { Library as LibraryIcon, Upload } from "lucide-react"

export default function LibraryPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [selected, setSelected] = useState<LibraryDocument | null>(null)

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="container mx-auto flex flex-1 items-center justify-center px-4 py-16">
          <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center">
            <LibraryIcon className="mx-auto mb-3 h-10 w-10 text-primary" aria-hidden="true" />
            <h1 className="mb-2 text-2xl font-semibold text-foreground">Sign in to view your library</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Your processed documents are tied to your account so RAG search stays scoped to you.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 md:py-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-bold text-foreground">
              <LibraryIcon className="h-6 w-6 text-primary" aria-hidden="true" />
              Your library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask questions across every document you have processed, or focus on a single one.
            </p>
          </div>
          <Button onClick={() => router.push("/upload")} className="gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Add document</span>
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <LibraryList
            selectedDocId={selected?.id ?? null}
            onSelect={setSelected}
          />
          <RagChat
            docId={selected?.id ?? null}
            docName={selected?.name ?? null}
            initialMode={selected ? "cag" : "rag"}
          />
        </div>
      </main>
      <Footer />
    </div>
  )
}

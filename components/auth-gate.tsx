"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Lock, LogIn, UserPlus, Sparkles, Library } from "lucide-react"

/**
 * Wraps a section so that its children only render for signed-in users.
 *
 * If the user is anonymous, shows a friendly sign-in CTA card explaining
 * *why* auth is required (per-user Pinecone namespace + SQLite scope).
 * Without this gate, uploads were being indexed under "anonymous" — leaking
 * data between sessions and breaking the per-user library promise.
 */
type Props = {
  children: ReactNode
  title?: string
  description?: string
}

export function AuthGate({
  children,
  title = "Sign in to continue",
  description = "Your library is tied to your account. Signing in keeps your indexed documents private and scoped to you, so Q&A, quizzes, and summaries only run over your own content.",
}: Props) {
  const { isAuthenticated, user } = useAuth()

  if (isAuthenticated && user) {
    return (
      <>
        <SignedInBadge name={user.name} email={user.email} />
        {children}
      </>
    )
  }

  return (
    <Card className="bg-card border-border max-w-xl mx-auto overflow-hidden">
      <div className="relative isolate">
        <div
          className="absolute inset-0 -z-10 bg-linear-to-br from-primary/15 via-purple-500/10 to-transparent"
          aria-hidden="true"
        />
        <CardContent className="p-8 md:p-10 space-y-6 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center ring-4 ring-primary/10">
            <Lock className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
              {description}
            </p>
          </div>

          <ul className="text-left space-y-2 max-w-sm mx-auto">
            <li className="flex items-start gap-3 text-sm text-foreground/90">
              <Library className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
              <span>Your <strong>personal library</strong> in Pinecone — nobody else can search your documents.</span>
            </li>
            <li className="flex items-start gap-3 text-sm text-foreground/90">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
              <span>Quizzes, flashcards, and Q&A are <strong>grounded in only your uploads</strong>.</span>
            </li>
          </ul>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild className="gap-2">
              <Link href="/sign-in">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/sign-up">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create account
              </Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Don&apos;t have time? Use any email + a 6-character password — accounts are stored locally.
          </p>
        </CardContent>
      </div>
    </Card>
  )
}

function SignedInBadge({ name, email }: { name: string; email: string }) {
  return (
    <div className="mb-6 flex items-center justify-center">
      <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-sm">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
          {(name || email).slice(0, 1).toUpperCase()}
        </span>
        <span className="text-foreground">
          Signed in as <strong>{name}</strong>
          <span className="text-muted-foreground hidden sm:inline"> · {email}</span>
        </span>
      </div>
    </div>
  )
}

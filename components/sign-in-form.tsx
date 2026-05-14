"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth, type SignInResult } from "./auth-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Accessibility, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react"

export function SignInForm() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorKind, setErrorKind] = useState<SignInResult | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorKind(null)

    const result = await signIn(email, password)

    if (result === "ok") {
      router.push("/upload")
    } else {
      setErrorKind(result)
      setIsLoading(false)
    }
  }

  return (
    <Card className="max-w-md mx-auto bg-card border-border">
      <CardHeader className="text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Accessibility className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <CardTitle className="text-2xl text-foreground">Welcome back</CardTitle>
        <CardDescription className="text-muted-foreground">
          Sign in to access your NovaPulse library
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorKind && <SignInError kind={errorKind} email={email} />}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errorKind) setErrorKind(null)
              }}
              required
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errorKind) setErrorKind(null)
                }}
                required
                minLength={6}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="text-primary hover:underline font-medium">
              Create one
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function SignInError({ kind, email }: { kind: SignInResult; email: string }) {
  const messages: Record<Exclude<SignInResult, "ok">, { text: React.ReactNode }> = {
    no_account: {
      text: (
        <>
          No account found for <strong>{email || "this email"}</strong>.{" "}
          <Link href="/sign-up" className="underline font-medium">
            Sign up instead
          </Link>
          .
        </>
      ),
    },
    wrong_password: {
      text: <>Incorrect password. Please try again.</>,
    },
    invalid_input: {
      text: <>Please enter a valid email and password.</>,
    },
  }
  const entry = messages[kind as Exclude<SignInResult, "ok">]
  if (!entry) return null
  return (
    <div
      className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm"
      role="alert"
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-destructive/90">{entry.text}</span>
    </div>
  )
}

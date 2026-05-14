"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth, type SignUpResult } from "./auth-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Accessibility, Loader2, AlertCircle, Eye, EyeOff, Check } from "lucide-react"

type FormErrorKind = SignUpResult | "passwords_mismatch"

export function SignUpForm() {
  const router = useRouter()
  const { signUp } = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorKind, setErrorKind] = useState<FormErrorKind | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorKind(null)

    if (password !== confirmPassword) {
      setErrorKind("passwords_mismatch")
      return
    }

    setIsLoading(true)
    const result = await signUp(email, password, name)
    if (result === "ok") {
      router.push("/upload")
    } else {
      setErrorKind(result)
      setIsLoading(false)
    }
  }

  // Live password requirement indicators
  const reqLength = password.length >= 6
  const reqMatch = password.length > 0 && password === confirmPassword

  return (
    <Card className="max-w-md mx-auto bg-card border-border">
      <CardHeader className="text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Accessibility className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <CardTitle className="text-2xl text-foreground">Create your account</CardTitle>
        <CardDescription className="text-muted-foreground">
          Your library, your indexed documents, your AI study tools.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorKind && <SignUpError kind={errorKind} email={email} />}

          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground">
              Full name
            </Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errorKind) setErrorKind(null)
              }}
              required
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

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
                autoComplete="new-password"
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

          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-foreground">
              Confirm password
            </Label>
            <Input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                if (errorKind) setErrorKind(null)
              }}
              required
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Live password requirements */}
          {(password.length > 0 || confirmPassword.length > 0) && (
            <ul className="text-xs space-y-1.5 pl-1">
              <Requirement met={reqLength} text="At least 6 characters" />
              <Requirement met={reqMatch} text="Passwords match" />
            </ul>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !reqLength || !reqMatch}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Creating account...
              </>
            ) : (
              "Create account"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function Requirement({ met, text }: { met: boolean; text: string }) {
  return (
    <li
      className={`flex items-center gap-2 transition-colors ${
        met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
          met ? "border-emerald-500 bg-emerald-500/20" : "border-muted-foreground/40"
        }`}
        aria-hidden="true"
      >
        {met && <Check className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />}
      </span>
      {text}
    </li>
  )
}

function SignUpError({ kind, email }: { kind: FormErrorKind; email: string }) {
  const messages: Record<Exclude<FormErrorKind, "ok">, { text: React.ReactNode }> = {
    email_taken: {
      text: (
        <>
          An account already exists for <strong>{email || "this email"}</strong>.{" "}
          <Link href="/sign-in" className="underline font-medium">
            Sign in instead
          </Link>
          .
        </>
      ),
    },
    weak_password: {
      text: <>Password must be at least 6 characters.</>,
    },
    invalid_input: {
      text: <>Please fill in name, email, and password.</>,
    },
    passwords_mismatch: {
      text: <>The two passwords don&apos;t match.</>,
    },
  }
  const entry = messages[kind as Exclude<FormErrorKind, "ok">]
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

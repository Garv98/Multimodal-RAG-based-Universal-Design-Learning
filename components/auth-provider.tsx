"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

/* ──────────────────────────────────────────────────────────────────────────
 * Local-only auth for the hackathon demo.
 *
 * Accounts live in localStorage at `udl-accounts` keyed by normalized email.
 * Passwords are SHA-256 hashed with an email-based salt so identical passwords
 * across accounts produce different hashes. The user_id sent on every backend
 * call (X-User-Id) is deterministically derived from the email so re-signing
 * in returns to the same Pinecone namespace and SQLite scope.
 *
 * This is intentionally client-only — no backend account table. For real
 * deployment, swap `signIn`/`signUp` to call a server endpoint and validate
 * a JWT on every backend request.
 * ────────────────────────────────────────────────────────────────────────── */

interface User {
  id: string
  email: string
  name: string
}

interface StoredAccount {
  email: string
  passwordHash: string
  name: string
  createdAt: string
}

export type SignInResult = "ok" | "no_account" | "wrong_password" | "invalid_input"
export type SignUpResult = "ok" | "email_taken" | "weak_password" | "invalid_input"

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<SignInResult>
  signUp: (email: string, password: string, name: string) => Promise<SignUpResult>
  signOut: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const SESSION_KEY = "udl-user"
const ACCOUNTS_KEY = "udl-accounts"
const PASSWORD_MIN_LENGTH = 6

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function deriveUserId(normalizedEmail: string): string {
  let hash = 0
  for (let i = 0; i < normalizedEmail.length; i++) {
    hash = ((hash << 5) - hash + normalizedEmail.charCodeAt(i)) | 0
  }
  return `user-${Math.abs(hash).toString(36)}`
}

async function hashPassword(password: string, normalizedEmail: string): Promise<string> {
  // Email is mixed in as a per-user salt; the suffix is a constant pepper.
  const data = new TextEncoder().encode(`${normalizedEmail}::${password}::novapulse-v1`)
  const buf = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function loadAccounts(): Record<string, StoredAccount> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, StoredAccount>) : {}
  } catch {
    return {}
  }
}

function saveAccounts(accounts: Record<string, StoredAccount>) {
  if (typeof window === "undefined") return
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

function persistSession(user: User | null) {
  if (typeof window === "undefined") return
  if (user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    localStorage.setItem("udl-user-id", user.id)
  } else {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem("udl-user-id")
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  // Restore session on mount. If the stored session points at an email that
  // is no longer in the accounts table (e.g. user wiped accounts), clear it.
  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem(SESSION_KEY)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as User
      const accounts = loadAccounts()
      const account = accounts[normalizeEmail(parsed.email)]
      if (account) {
        setUser(parsed)
      } else {
        // Stale session from the old mocked auth — silently sign out.
        persistSession(null)
      }
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<SignInResult> => {
    const normalized = normalizeEmail(email)
    if (!normalized || !password) return "invalid_input"

    // tiny artificial delay so the loading spinner is visible
    await new Promise((r) => setTimeout(r, 300))

    const accounts = loadAccounts()
    const account = accounts[normalized]
    if (!account) return "no_account"

    const hash = await hashPassword(password, normalized)
    if (hash !== account.passwordHash) return "wrong_password"

    const next: User = {
      id: deriveUserId(normalized),
      email: account.email,
      name: account.name,
    }
    setUser(next)
    persistSession(next)
    return "ok"
  }

  const signUp = async (
    email: string,
    password: string,
    name: string,
  ): Promise<SignUpResult> => {
    const normalized = normalizeEmail(email)
    const trimmedName = name.trim()
    if (!normalized || !password || !trimmedName) return "invalid_input"
    if (password.length < PASSWORD_MIN_LENGTH) return "weak_password"

    await new Promise((r) => setTimeout(r, 300))

    const accounts = loadAccounts()
    if (accounts[normalized]) return "email_taken"

    const passwordHash = await hashPassword(password, normalized)
    accounts[normalized] = {
      email: normalized,
      passwordHash,
      name: trimmedName,
      createdAt: new Date().toISOString(),
    }
    saveAccounts(accounts)

    const next: User = {
      id: deriveUserId(normalized),
      email: normalized,
      name: trimmedName,
    }
    setUser(next)
    persistSession(next)
    return "ok"
  }

  const signOut = () => {
    setUser(null)
    persistSession(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

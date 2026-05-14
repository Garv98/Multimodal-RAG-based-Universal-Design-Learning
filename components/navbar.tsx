"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "./auth-provider"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Accessibility, Menu, User, LogOut, Video, Library, Upload, Home as HomeIcon } from "lucide-react"

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; authOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/library", label: "Library", icon: Library, authOnly: true },
  { href: "/video", label: "Video", icon: Video },
]

export function Navbar() {
  const { user, isAuthenticated, signOut } = useAuth()
  const pathname = usePathname()
  const items = NAV_ITEMS.filter((item) => !item.authOnly || isAuthenticated)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/80 backdrop-blur-xl supports-backdrop-filter:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 group" aria-label="NovaPulse Home">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/30 blur-md rounded-full group-hover:bg-primary/40 transition-colors" aria-hidden="true" />
            <Accessibility className="relative h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground hidden sm:inline">
            Nova<span className="text-primary">Pulse</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
          {items.map((item) => {
            const active = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5
                  ${active
                    ? "text-foreground bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
                {active && (
                  <span
                    className="absolute -bottom-px left-1/2 -translate-x-1/2 h-0.5 w-6 bg-primary rounded-full"
                    aria-hidden="true"
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                  <span className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                    {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline max-w-32 truncate">{user?.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-2">
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="text-sm font-medium truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/library">
                    <Library className="mr-2 h-4 w-4" aria-hidden="true" />
                    My library
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="hidden sm:flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/sign-up">Get started</Link>
              </Button>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href}>
                      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
              {!isAuthenticated && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/sign-in">Sign in</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/sign-up">Get started</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

"use client"

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  ReactNode,
} from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Eye,
  Type,
  Sun,
  Moon,
  Minus,
  Plus,
  Volume2,
  VolumeX,
  Focus,
  Wind,
  AlignJustify,
  ScanLine,
  Space,
  Sparkles,
  BookOpen,
  Image as ImageIcon,
  ZoomIn,
  RotateCcw,
  Palette,
} from "lucide-react"

/* ─────────────────────────────────────────────────────────────────────────────
 * Settings model
 *
 * Note: the heavy lifting CSS lives in app/globals.css (high-contrast OKLCH
 * overrides, dyslexia font, color-blind filters, font-scale, line/letter
 * spacing). This file only injects what globals.css doesn't have (bionic
 * reading, alternative contrast schemes, word-spacing var, hide-images).
 * ─────────────────────────────────────────────────────────────────────────── */

type ContrastMode = "default" | "high" | "yellow-on-black" | "sepia" | "inverted"
type ColorBlindMode = "none" | "protanopia" | "deuteranopia" | "tritanopia"

interface AccessibilitySettings {
  // Vision
  contrastMode: ContrastMode
  darkMode: boolean
  colorBlindMode: ColorBlindMode
  fontScale: number // 100..200, %

  // Reading
  dyslexiaMode: boolean
  bionicReading: boolean
  readingGuide: boolean // line ruler — dims everything outside the cursor's line
  lineSpacing: number // 100..300, %
  letterSpacing: number // 0..0.5, em
  wordSpacing: number // 0..1, em

  // Motion & focus
  focusMode: boolean
  reducedMotion: boolean
  hideImages: boolean

  // Audio
  textSelectionReader: boolean
  voiceSpeed: number // 0.5..1.5
}

const defaultSettings: AccessibilitySettings = {
  contrastMode: "default",
  darkMode: true,
  colorBlindMode: "none",
  fontScale: 100,

  dyslexiaMode: false,
  bionicReading: false,
  readingGuide: false,
  lineSpacing: 150,
  letterSpacing: 0,
  wordSpacing: 0,

  focusMode: false,
  reducedMotion: false,
  hideImages: false,

  textSelectionReader: true,
  voiceSpeed: 0.95,
}

interface AccessibilityContextType {
  settings: AccessibilitySettings
  updateSetting: <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => void
  applyPreset: (preset: PresetId) => void
  resetSettings: () => void
}

const AccessibilityContext = createContext<AccessibilityContextType | null>(null)

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext)
  if (!ctx) {
    throw new Error("useAccessibility must be used within AccessibilityProvider")
  }
  return ctx
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Style injector — ONLY the things globals.css doesn't already handle.
 * ─────────────────────────────────────────────────────────────────────────── */

export function AccessibilityStyles() {
  return (
    <style>{`
      /* Word spacing — globals.css doesn't define this var */
      :root { --udl-word-spacing: 0em; }
      body { word-spacing: var(--udl-word-spacing, 0em); }

      /* ── Bionic reading: bolded first portion of every word ── */
      .bionic-word b {
        font-weight: 700 !important;
      }

      /* ── Alternative contrast schemes (high-contrast already lives in globals.css) ── */
      body.contrast-yellow-on-black {
        --background: oklch(0 0 0);
        --foreground: oklch(0.95 0.22 95);
        --card: oklch(0.05 0 0);
        --card-foreground: oklch(0.95 0.22 95);
        --popover: oklch(0.05 0 0);
        --popover-foreground: oklch(0.95 0.22 95);
        --primary: oklch(0.95 0.22 95);
        --primary-foreground: oklch(0 0 0);
        --secondary: oklch(0.15 0.1 95);
        --secondary-foreground: oklch(0.95 0.22 95);
        --muted: oklch(0.15 0 0);
        --muted-foreground: oklch(0.75 0.18 95);
        --border: oklch(0.95 0.22 95);
        --input: oklch(0.1 0 0);
        --ring: oklch(0.95 0.22 95);
      }
      body.contrast-sepia {
        --background: oklch(0.93 0.04 80);
        --foreground: oklch(0.25 0.06 50);
        --card: oklch(0.95 0.03 80);
        --card-foreground: oklch(0.25 0.06 50);
        --popover: oklch(0.95 0.03 80);
        --popover-foreground: oklch(0.25 0.06 50);
        --primary: oklch(0.4 0.12 40);
        --primary-foreground: oklch(0.96 0.02 80);
        --muted: oklch(0.88 0.03 80);
        --muted-foreground: oklch(0.45 0.05 50);
        --border: oklch(0.75 0.04 50);
        --ring: oklch(0.4 0.12 40);
      }
      body.contrast-inverted {
        filter: invert(1) hue-rotate(180deg);
      }
      body.contrast-inverted img,
      body.contrast-inverted video,
      body.contrast-inverted [data-no-invert] {
        filter: invert(1) hue-rotate(180deg);
      }

      /* ── Hide images ── */
      body.hide-images img,
      body.hide-images video,
      body.hide-images svg:not(.udl-keep-svg):not([role="img"]) {
        visibility: hidden !important;
      }

      /* ── Line ruler — dim overlays are rendered as React divs.
            Cursor hint so users know the ruler is tracking. ── */
      body.line-ruler { cursor: text; }

      /* ── Reduced motion: globals.css already covers this. Belt-and-suspenders ── */
      body.reduced-motion .udl-no-motion-on-reduce {
        animation: none !important;
        transition: none !important;
      }
    `}</style>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Color vision SVG filters
 * ─────────────────────────────────────────────────────────────────────────── */

export function ColorVisionFilters() {
  return (
    <svg
      style={{ display: "none", position: "absolute", width: 0, height: 0 }}
      aria-hidden="true"
    >
      <defs>
        <filter id="protanopia-filter">
          <feColorMatrix
            type="matrix"
            values="0.567 0.433 0 0 0
                    0.558 0.442 0 0 0
                    0     0.242 0.758 0 0
                    0     0     0 1 0"
          />
        </filter>
        <filter id="deuteranopia-filter">
          <feColorMatrix
            type="matrix"
            values="0.625 0.375 0 0 0
                    0.7   0.3   0 0 0
                    0     0.3   0.7 0 0
                    0     0     0 1 0"
          />
        </filter>
        <filter id="tritanopia-filter">
          <feColorMatrix
            type="matrix"
            values="0.95 0.05 0 0 0
                    0    0.433 0.567 0 0
                    0    0.475 0.525 0 0
                    0    0     0 1 0"
          />
        </filter>
      </defs>
    </svg>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Bionic reading: walk the main content and bold the first ~40% of every word
 * ─────────────────────────────────────────────────────────────────────────── */

const BIONIC_TARGET_SELECTOR = "main, article, p, .udl-content"
const BIONIC_SKIP_SELECTOR =
  ".bionic-word, .accessibility-panel-fixed, .reading-ruler-overlay, script, style, code, pre, [data-no-bionic]"

function applyBionicReading() {
  if (typeof document === "undefined") return
  const containers = document.querySelectorAll(BIONIC_TARGET_SELECTOR)
  containers.forEach((container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest(BIONIC_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT
        if (!node.textContent || !node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const nodes: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) nodes.push(n as Text)

    nodes.forEach((textNode) => {
      const text = textNode.textContent || ""
      const fragment = document.createDocumentFragment()
      const parts = text.split(/(\s+)/)
      for (const part of parts) {
        if (!part) continue
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(part))
          continue
        }
        // Don't bolden if the "word" is just punctuation.
        if (!/[A-Za-z0-9]/.test(part)) {
          fragment.appendChild(document.createTextNode(part))
          continue
        }
        const span = document.createElement("span")
        span.className = "bionic-word"
        const splitAt = Math.max(1, Math.ceil(part.length * 0.4))
        const b = document.createElement("b")
        b.textContent = part.slice(0, splitAt)
        span.appendChild(b)
        span.appendChild(document.createTextNode(part.slice(splitAt)))
        fragment.appendChild(span)
      }
      textNode.replaceWith(fragment)
    })
  })
}

function removeBionicReading() {
  if (typeof document === "undefined") return
  document.querySelectorAll(".bionic-word").forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent || ""))
  })
  document.querySelectorAll(BIONIC_TARGET_SELECTOR).forEach((c) => {
    try {
      c.normalize()
    } catch {
      /* normalize is unsupported on detached nodes — ignore */
    }
  })
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Provider
 * ─────────────────────────────────────────────────────────────────────────── */

type PresetId = "default" | "dyslexia" | "lowVision" | "calm"

const PRESETS: Record<PresetId, Partial<AccessibilitySettings>> = {
  default: defaultSettings,
  dyslexia: {
    dyslexiaMode: true,
    bionicReading: true,
    lineSpacing: 200,
    letterSpacing: 0.1,
    wordSpacing: 0.25,
    fontScale: 115,
  },
  lowVision: {
    contrastMode: "high",
    fontScale: 150,
    reducedMotion: true,
    lineSpacing: 200,
  },
  calm: {
    reducedMotion: true,
    focusMode: true,
    hideImages: false,
  },
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AccessibilitySettings>(defaultSettings)
  const [mounted, setMounted] = useState(false)

  // Load persisted settings (with backwards-compat migrations)
  useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem("udl-accessibility-settings")
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<AccessibilitySettings> & {
        highContrast?: boolean // legacy
      }
      // Migrate legacy highContrast boolean → contrastMode enum.
      if (parsed.highContrast && !parsed.contrastMode) {
        parsed.contrastMode = "high"
      }
      delete parsed.highContrast
      setSettings({ ...defaultSettings, ...parsed })
    } catch (e) {
      console.error("Failed to parse accessibility settings:", e)
    }
  }, [])

  // Reflect settings into DOM
  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement
    const body = document.body

    root.style.setProperty("--udl-line-height", `${settings.lineSpacing / 100}`)
    root.style.setProperty("--udl-letter-spacing", `${settings.letterSpacing}em`)
    root.style.setProperty("--udl-word-spacing", `${settings.wordSpacing}em`)
    root.style.setProperty("--udl-font-scale", `${settings.fontScale / 100}`)

    // Reset all contrast classes — only one active at a time.
    body.classList.remove(
      "high-contrast",
      "contrast-yellow-on-black",
      "contrast-sepia",
      "contrast-inverted"
    )
    if (settings.contrastMode === "high") body.classList.add("high-contrast")
    if (settings.contrastMode === "yellow-on-black")
      body.classList.add("contrast-yellow-on-black")
    if (settings.contrastMode === "sepia") body.classList.add("contrast-sepia")
    if (settings.contrastMode === "inverted")
      body.classList.add("contrast-inverted")

    body.classList.toggle("dyslexia-mode", settings.dyslexiaMode)
    body.classList.toggle("reduced-motion", settings.reducedMotion)
    body.classList.toggle("focus-mode", settings.focusMode)
    body.classList.toggle("hide-images", settings.hideImages)
    body.classList.toggle("line-ruler", settings.readingGuide)

    root.removeAttribute("data-color-blind")
    if (settings.colorBlindMode !== "none") {
      root.setAttribute("data-color-blind", settings.colorBlindMode)
    }

    root.classList.toggle("dark", settings.darkMode)

    localStorage.setItem("udl-accessibility-settings", JSON.stringify(settings))
  }, [settings, mounted])

  // Toggle bionic reading whenever the setting flips
  useEffect(() => {
    if (!mounted) return
    if (settings.bionicReading) {
      // Defer to next tick so React renders settle before we mutate DOM
      const id = window.setTimeout(applyBionicReading, 50)
      return () => window.clearTimeout(id)
    } else {
      removeBionicReading()
    }
  }, [settings.bionicReading, mounted])

  const updateSetting = useCallback(
    <K extends keyof AccessibilitySettings>(
      key: K,
      value: AccessibilitySettings[K]
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const applyPreset = useCallback((preset: PresetId) => {
    setSettings((prev) => ({ ...defaultSettings, ...prev, ...PRESETS[preset] }))
  }, [])

  const resetSettings = useCallback(() => {
    // Tear down any bionic DOM mutations before resetting state
    removeBionicReading()
    setSettings(defaultSettings)
    localStorage.removeItem("udl-accessibility-settings")
  }, [])

  return (
    <AccessibilityContext.Provider
      value={{ settings, updateSetting, applyPreset, resetSettings }}
    >
      <AccessibilityStyles />
      <ColorVisionFilters />
      {children}
    </AccessibilityContext.Provider>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Reusable panel rows
 * ─────────────────────────────────────────────────────────────────────────── */

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onToggle,
}: {
  icon: ReactNode
  label: string
  description?: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-tight">{label}</p>
          {description && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-border"
        }`}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
          style={{ left: checked ? 18 : 2 }}
        />
      </button>
    </div>
  )
}

function SliderRow({
  icon,
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
  onDecrement,
  onIncrement,
}: {
  icon: ReactNode
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (v: number) => void
  onDecrement: () => void
  onIncrement: () => void
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="text-muted-foreground">{icon}</span>
          {label}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {display}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onDecrement}
          className="h-6 w-6 shrink-0"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} slider`}
          className="flex-1 accent-primary cursor-pointer"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onIncrement}
          className="h-6 w-6 shrink-0"
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function ChoiceGrid<T extends string>({
  value,
  options,
  onChange,
  columns = 2,
}: {
  value: T
  options: { value: T; label: string; description?: string }[]
  onChange: (v: T) => void
  columns?: 1 | 2 | 3
}) {
  return (
    <div
      className={`grid gap-1.5 ${
        columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-3"
      }`}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`rounded-md border px-2.5 py-1.5 text-left transition ${
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-transparent text-foreground hover:bg-muted"
            }`}
          >
            <div className="text-[12px] font-medium leading-tight">{opt.label}</div>
            {opt.description && (
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {opt.description}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/70 mt-2 mb-1.5">
      {children}
    </p>
  )
}

function Divider() {
  return <hr className="my-2 border-t border-border/60" />
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Main panel
 * ─────────────────────────────────────────────────────────────────────────── */

export function AccessibilityPanel() {
  const { settings, updateSetting, applyPreset, resetSettings } = useAccessibility()
  const [isExpanded, setIsExpanded] = useState(false)
  const [tab, setTab] = useState<"vision" | "reading" | "motion">("vision")

  const activeCount =
    (settings.contrastMode !== "default" ? 1 : 0) +
    (settings.colorBlindMode !== "none" ? 1 : 0) +
    (settings.fontScale !== 100 ? 1 : 0) +
    (settings.dyslexiaMode ? 1 : 0) +
    (settings.bionicReading ? 1 : 0) +
    (settings.readingGuide ? 1 : 0) +
    (settings.lineSpacing !== 150 ? 1 : 0) +
    (settings.letterSpacing !== 0 ? 1 : 0) +
    (settings.wordSpacing !== 0 ? 1 : 0) +
    (settings.focusMode ? 1 : 0) +
    (settings.reducedMotion ? 1 : 0) +
    (settings.hideImages ? 1 : 0)

  return (
    <div className="fixed bottom-4 right-4 z-[9999] accessibility-panel-fixed">
      {/* ── Floating action button ── */}
      <div className="relative">
        {activeCount > 0 && (
          <span
            aria-label={`${activeCount} accessibility features active`}
            className="absolute -top-1 -right-1 z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background"
          >
            {activeCount}
          </span>
        )}
        <Button
          onClick={() => setIsExpanded((v) => !v)}
          variant="outline"
          aria-label="Accessibility settings"
          aria-expanded={isExpanded}
          className="h-11 w-11 rounded-full p-0 shadow-lg"
        >
          <Eye className="h-5 w-5" />
        </Button>
      </div>

      {/* ── Panel ── */}
      {isExpanded && (
        <div
          role="dialog"
          aria-label="Accessibility settings panel"
          className="absolute bottom-14 right-0 w-[340px] max-h-[82vh] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <Eye className="h-4 w-4 text-primary shrink-0" />
              <p className="text-[14px] font-semibold leading-tight">Accessibility</p>
              {activeCount > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">
                  {activeCount} active
                </Badge>
              )}
            </div>
            <button
              onClick={resetSettings}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              title="Reset all settings"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>

          {/* Live preview */}
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
              Preview
            </p>
            <p
              className="text-[13px] text-foreground"
              style={{
                lineHeight: settings.lineSpacing / 100,
                letterSpacing: `${settings.letterSpacing}em`,
                wordSpacing: `${settings.wordSpacing}em`,
                fontSize: `${(settings.fontScale / 100) * 13}px`,
                fontFamily: settings.dyslexiaMode
                  ? "'OpenDyslexic', sans-serif"
                  : undefined,
              }}
            >
              The quick brown fox jumps over the lazy dog. Reading should feel
              effortless.
            </p>
          </div>

          {/* Quick presets */}
          <div className="px-4 py-2.5 border-b border-border">
            <SectionHeader>Quick presets</SectionHeader>
            <div className="grid grid-cols-2 gap-1.5">
              <PresetButton
                icon={<BookOpen className="h-3 w-3" />}
                label="Dyslexia"
                onClick={() => applyPreset("dyslexia")}
              />
              <PresetButton
                icon={<ZoomIn className="h-3 w-3" />}
                label="Low vision"
                onClick={() => applyPreset("lowVision")}
              />
              <PresetButton
                icon={<Wind className="h-3 w-3" />}
                label="Calm mode"
                onClick={() => applyPreset("calm")}
              />
              <PresetButton
                icon={<Sparkles className="h-3 w-3" />}
                label="Default"
                onClick={() => applyPreset("default")}
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="mx-4 mt-2 grid grid-cols-3 h-8">
              <TabsTrigger value="vision" className="text-[11px]">
                Vision
              </TabsTrigger>
              <TabsTrigger value="reading" className="text-[11px]">
                Reading
              </TabsTrigger>
              <TabsTrigger value="motion" className="text-[11px]">
                Focus &amp; audio
              </TabsTrigger>
            </TabsList>

            <div className="overflow-y-auto flex-1 px-4 pb-3">
              {/* ──────── VISION ──────── */}
              <TabsContent value="vision" className="mt-2 mb-0">
                <SectionHeader>Contrast scheme</SectionHeader>
                <ChoiceGrid<ContrastMode>
                  value={settings.contrastMode}
                  onChange={(v) => updateSetting("contrastMode", v)}
                  columns={1}
                  options={[
                    { value: "default", label: "Default", description: "Site theme" },
                    {
                      value: "high",
                      label: "High contrast",
                      description: "Black + white with amber accents",
                    },
                    {
                      value: "yellow-on-black",
                      label: "Yellow on black",
                      description: "Maximum readability for low vision",
                    },
                    {
                      value: "sepia",
                      label: "Sepia",
                      description: "Warm low-glare paper feel",
                    },
                    {
                      value: "inverted",
                      label: "Inverted",
                      description: "Flip colors (images stay correct)",
                    },
                  ]}
                />

                <Divider />

                <ToggleRow
                  icon={
                    settings.darkMode ? (
                      <Moon className="h-3.5 w-3.5" />
                    ) : (
                      <Sun className="h-3.5 w-3.5" />
                    )
                  }
                  label={settings.darkMode ? "Dark mode" : "Light mode"}
                  description={
                    settings.darkMode ? "Tap to switch to light" : "Tap to switch to dark"
                  }
                  checked={settings.darkMode}
                  onToggle={() => updateSetting("darkMode", !settings.darkMode)}
                />

                <Divider />

                <SectionHeader>Color vision filter</SectionHeader>
                <ChoiceGrid<ColorBlindMode>
                  value={settings.colorBlindMode}
                  onChange={(v) => updateSetting("colorBlindMode", v)}
                  columns={2}
                  options={[
                    { value: "none", label: "None" },
                    { value: "protanopia", label: "Protanopia", description: "Red-blind" },
                    {
                      value: "deuteranopia",
                      label: "Deuteranopia",
                      description: "Green-blind",
                    },
                    {
                      value: "tritanopia",
                      label: "Tritanopia",
                      description: "Blue-blind",
                    },
                  ]}
                />

                <Divider />

                <SliderRow
                  icon={<ZoomIn className="h-3.5 w-3.5" />}
                  label="Font size"
                  min={80}
                  max={200}
                  step={10}
                  value={settings.fontScale}
                  display={`${settings.fontScale}%`}
                  onChange={(v) => updateSetting("fontScale", v)}
                  onDecrement={() =>
                    updateSetting("fontScale", Math.max(80, settings.fontScale - 10))
                  }
                  onIncrement={() =>
                    updateSetting("fontScale", Math.min(200, settings.fontScale + 10))
                  }
                />

                <ToggleRow
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Hide images"
                  description="Useful when on metered data or photo-sensitive"
                  checked={settings.hideImages}
                  onToggle={() => updateSetting("hideImages", !settings.hideImages)}
                />
              </TabsContent>

              {/* ──────── READING ──────── */}
              <TabsContent value="reading" className="mt-2 mb-0">
                <ToggleRow
                  icon={<Type className="h-3.5 w-3.5" />}
                  label="Dyslexia font"
                  description="OpenDyslexic with extra letter and word spacing"
                  checked={settings.dyslexiaMode}
                  onToggle={() =>
                    updateSetting("dyslexiaMode", !settings.dyslexiaMode)
                  }
                />

                <ToggleRow
                  icon={<Palette className="h-3.5 w-3.5" />}
                  label="Bionic reading"
                  description="Bolds the first part of each word to speed reading"
                  checked={settings.bionicReading}
                  onToggle={() =>
                    updateSetting("bionicReading", !settings.bionicReading)
                  }
                />

                <ToggleRow
                  icon={<ScanLine className="h-3.5 w-3.5" />}
                  label="Line ruler"
                  description="Dims everything outside the line you're reading"
                  checked={settings.readingGuide}
                  onToggle={() =>
                    updateSetting("readingGuide", !settings.readingGuide)
                  }
                />

                <Divider />

                <SliderRow
                  icon={<AlignJustify className="h-3.5 w-3.5" />}
                  label="Line spacing"
                  min={100}
                  max={300}
                  step={25}
                  value={settings.lineSpacing}
                  display={`${settings.lineSpacing}%`}
                  onChange={(v) => updateSetting("lineSpacing", v)}
                  onDecrement={() =>
                    updateSetting(
                      "lineSpacing",
                      Math.max(100, settings.lineSpacing - 25)
                    )
                  }
                  onIncrement={() =>
                    updateSetting(
                      "lineSpacing",
                      Math.min(300, settings.lineSpacing + 25)
                    )
                  }
                />

                <SliderRow
                  icon={<Space className="h-3.5 w-3.5" />}
                  label="Letter spacing"
                  min={0}
                  max={50}
                  step={5}
                  value={Math.round(settings.letterSpacing * 100)}
                  display={`${settings.letterSpacing.toFixed(2)}em`}
                  onChange={(v) => updateSetting("letterSpacing", v / 100)}
                  onDecrement={() =>
                    updateSetting(
                      "letterSpacing",
                      Math.max(
                        0,
                        parseFloat((settings.letterSpacing - 0.05).toFixed(2))
                      )
                    )
                  }
                  onIncrement={() =>
                    updateSetting(
                      "letterSpacing",
                      Math.min(
                        0.5,
                        parseFloat((settings.letterSpacing + 0.05).toFixed(2))
                      )
                    )
                  }
                />

                <SliderRow
                  icon={<Space className="h-3.5 w-3.5" />}
                  label="Word spacing"
                  min={0}
                  max={100}
                  step={10}
                  value={Math.round(settings.wordSpacing * 100)}
                  display={`${settings.wordSpacing.toFixed(2)}em`}
                  onChange={(v) => updateSetting("wordSpacing", v / 100)}
                  onDecrement={() =>
                    updateSetting(
                      "wordSpacing",
                      Math.max(
                        0,
                        parseFloat((settings.wordSpacing - 0.1).toFixed(2))
                      )
                    )
                  }
                  onIncrement={() =>
                    updateSetting(
                      "wordSpacing",
                      Math.min(
                        1,
                        parseFloat((settings.wordSpacing + 0.1).toFixed(2))
                      )
                    )
                  }
                />
              </TabsContent>

              {/* ──────── MOTION & AUDIO ──────── */}
              <TabsContent value="motion" className="mt-2 mb-0">
                <ToggleRow
                  icon={<Focus className="h-3.5 w-3.5" />}
                  label="Focus mode"
                  description="Dims headers, sidebars and footers"
                  checked={settings.focusMode}
                  onToggle={() => updateSetting("focusMode", !settings.focusMode)}
                />

                <ToggleRow
                  icon={<Wind className="h-3.5 w-3.5" />}
                  label="Reduce motion"
                  description="Disables non-essential animation"
                  checked={settings.reducedMotion}
                  onToggle={() =>
                    updateSetting("reducedMotion", !settings.reducedMotion)
                  }
                />

                <Divider />

                <SectionHeader>Audio</SectionHeader>

                <ToggleRow
                  icon={<Volume2 className="h-3.5 w-3.5" />}
                  label="Read selected text"
                  description='Shows "Read Aloud" when you highlight text'
                  checked={settings.textSelectionReader}
                  onToggle={() =>
                    updateSetting("textSelectionReader", !settings.textSelectionReader)
                  }
                />

                <SliderRow
                  icon={<Volume2 className="h-3.5 w-3.5" />}
                  label="Reading speed"
                  min={50}
                  max={150}
                  step={5}
                  value={Math.round(settings.voiceSpeed * 100)}
                  display={`${settings.voiceSpeed.toFixed(2)}×`}
                  onChange={(v) => updateSetting("voiceSpeed", v / 100)}
                  onDecrement={() =>
                    updateSetting(
                      "voiceSpeed",
                      Math.max(0.5, parseFloat((settings.voiceSpeed - 0.05).toFixed(2)))
                    )
                  }
                  onIncrement={() =>
                    updateSetting(
                      "voiceSpeed",
                      Math.min(1.5, parseFloat((settings.voiceSpeed + 0.05).toFixed(2)))
                    )
                  }
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </div>
  )
}

function PresetButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted transition"
    >
      {icon}
      {label}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Text-selection reader — picks up the live voiceSpeed setting
 * ─────────────────────────────────────────────────────────────────────────── */

export function TextSelectionReader() {
  const { settings } = useAccessibility()
  const [selectedText, setSelectedText] = useState("")
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [showButton, setShowButton] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  useEffect(() => {
    if (!settings.textSelectionReader) {
      setShowButton(false)
      return
    }

    const handleSelection = () => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (text && text.length > 0) {
        setSelectedText(text)
        const range = selection?.getRangeAt(0)
        const rect = range?.getBoundingClientRect()
        if (rect) {
          setPosition({ x: rect.left + rect.width / 2, y: rect.top - 50 })
          setShowButton(true)
        }
      } else {
        setShowButton(false)
      }
    }

    document.addEventListener("mouseup", handleSelection)
    document.addEventListener("keyup", handleSelection)
    document.addEventListener("touchend", handleSelection)
    return () => {
      document.removeEventListener("mouseup", handleSelection)
      document.removeEventListener("keyup", handleSelection)
      document.removeEventListener("touchend", handleSelection)
    }
  }, [settings.textSelectionReader])

  const speakSelection = () => {
    if (!("speechSynthesis" in window) || !selectedText) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(selectedText)
    utterance.rate = settings.voiceSpeed
    utterance.pitch = 1.0
    utterance.volume = 1.0
    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => {
      setIsSpeaking(false)
      setShowButton(false)
    }
    utterance.onerror = () => {
      setIsSpeaking(false)
      setShowButton(false)
    }
    window.speechSynthesis.speak(utterance)
  }

  const stopSpeaking = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
    }
  }

  if (!showButton) return null

  return (
    <div
      className="fixed z-[10000] animate-in fade-in zoom-in duration-200"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translateX(-50%)",
      }}
    >
      <Button
        onClick={isSpeaking ? stopSpeaking : speakSelection}
        size="sm"
        className="shadow-lg bg-primary hover:bg-primary/90 gap-2"
        title={isSpeaking ? "Stop reading" : "Read selected text aloud"}
      >
        {isSpeaking ? (
          <>
            <VolumeX className="h-4 w-4" />
            <span className="text-xs">Stop</span>
          </>
        ) : (
          <>
            <Volume2 className="h-4 w-4" />
            <span className="text-xs">Read Aloud</span>
          </>
        )}
      </Button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ReadingGuide — NEW behavior: line ruler.
 *
 * Two fixed overlays darken the area above and below the cursor's Y; the
 * cursor's line stays at full brightness. This is a genuinely useful reading
 * aid (matches how Beeline / focus-readers work), unlike the previous
 * "thick teal band" version which just decorated the cursor.
 * ─────────────────────────────────────────────────────────────────────────── */

const RULER_STRIP_HEIGHT = 56
const RULER_DIM_OPACITY = 0.55

export function ReadingGuide() {
  const { settings } = useAccessibility()
  const [y, setY] = useState<number>(-9999) // start offscreen
  const [vh, setVh] = useState(0)

  useEffect(() => {
    if (!settings.readingGuide) return
    const handleMove = (e: MouseEvent) => setY(e.clientY)
    const handleTouch = (e: TouchEvent) => {
      if (e.touches[0]) setY(e.touches[0].clientY)
    }
    const updateVh = () => setVh(window.innerHeight)
    updateVh()
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("touchmove", handleTouch)
    window.addEventListener("resize", updateVh)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("touchmove", handleTouch)
      window.removeEventListener("resize", updateVh)
    }
  }, [settings.readingGuide])

  if (!settings.readingGuide) return null

  const half = RULER_STRIP_HEIGHT / 2
  const topHeight = Math.max(0, y - half)
  const bottomTop = Math.min(vh, y + half)
  const bottomHeight = Math.max(0, vh - bottomTop)

  return (
    <div className="reading-ruler-overlay" aria-hidden="true">
      {/* dim above */}
      <div
        className="udl-no-motion-on-reduce"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: topHeight,
          background: `rgba(0,0,0,${RULER_DIM_OPACITY})`,
          pointerEvents: "none",
          zIndex: 9998,
          transition: "height 60ms linear",
        }}
      />
      {/* dim below */}
      <div
        className="udl-no-motion-on-reduce"
        style={{
          position: "fixed",
          top: bottomTop,
          left: 0,
          right: 0,
          height: bottomHeight,
          background: `rgba(0,0,0,${RULER_DIM_OPACITY})`,
          pointerEvents: "none",
          zIndex: 9998,
          transition: "all 60ms linear",
        }}
      />
      {/* the bright reading strip — just a thin border framing the cursor's line */}
      <div
        style={{
          position: "fixed",
          top: Math.max(0, y - half),
          left: 0,
          right: 0,
          height: RULER_STRIP_HEIGHT,
          pointerEvents: "none",
          zIndex: 9998,
          borderTop: "2px solid hsl(var(--primary, 180 70% 60%))",
          borderBottom: "2px solid hsl(var(--primary, 180 70% 60%))",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.25)",
        }}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Cognitive load — unchanged scoring, just cleaner JSX
 * ─────────────────────────────────────────────────────────────────────────── */

function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "")
  if (!w) return 0
  const matches = w.match(/[aeiou]+/g)
  let count = matches ? matches.length : 1
  if (w.endsWith("e") && count > 1) count--
  return Math.max(1, count)
}

const RARE_WORDS = new Set([
  "epistemological","ontological","phenomenological","axiological","teleological",
  "hermeneutic","heuristic","paradigmatic","dialectical","hegemonic","liminal",
  "tautological","counterfactual","presupposes","adjudicative","constitutive",
  "derogatory","extraterritorially","doctrinal","notwithstanding","aforementioned",
  "jurisdictional","inasmuch","supervening","multilateral","unimpeached","purport",
  "inheres","derivative","legitimacy","procedural","validity","tribunal",
  "reconceptualisation","indeterminacy","unobserved","phenomena","epistemically",
  "commensurate","concomitant","ameliorate","amelioration","exacerbate","predicated",
  "contingent","pursuant","whereby","thereof","therein","herein","hereof","insofar",
  "forthwith","heretofore","hitherto","thereby","wherein","subsume","subsumed",
  "posited","evince","evinces","evinced","abjure","promulgate","promulgated",
  "envisage","obviate","interpolate","extrapolate","instantiate","delineate",
  "elucidate","presuppose","operationalise","conceptualise","instrumentalise",
  "recontextualise","problematise","circumscribe","instantiation","impugn",
])

const DISCOURSE_MARKERS = new Set([
  "notwithstanding","consequently","furthermore","nevertheless","inasmuch",
  "hitherto","heretofore","therefore","ergo","hence","wherein","whereby",
  "therein","herein","insofar","albeit","whereas","accordingly","conversely",
  "paradoxically","ostensibly","purportedly","ostensible",
])

const ABSTRACT_SUFFIX = /\b\w+(ity|ness|tion|sion|ism|ance|ence|ment|ship|hood|dom|ology|graphy)\b/g
const EMBEDDERS = /\b(that|which|who|whom|whose|where|when|although|because|since|while|unless|until|whether|in\s+order\s+that|so\s+that|insofar\s+as|inasmuch\s+as|notwithstanding\s+that)\b/gi
const PASSIVES = /\b(was|were|is|are|been|being)\s+\w+ed\b/gi
const NEGATIONS = /\b(not|never|neither|nor|without|unless|fail\s+to|lack\s+of|no\s+\w+)\b/gi
const ANAPHORA = /\b(it|its|they|their|them|this|these|those|he|she|his|her|which)\b/gi
const INTERRUPTIONS = /,\s*[^,]{20,},/g

function calculateLoad(text: string): {
  level: "low" | "medium" | "high"
  score: number
  details: string
} {
  if (!text || !text.trim()) {
    return { level: "low", score: 0, details: "No content" }
  }
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean)
  const words = text.split(/\s+/).filter((w) => w.trim().length > 0)
  const totalWords = words.length
  if (totalWords < 2) {
    return { level: "low", score: 5, details: "Too short to analyse" }
  }
  const avgSentLen = totalWords / Math.max(sentences.length, 1)
  const longSentCount = sentences.filter((s) => s.split(/\s+/).length > 25).length
  const surfaceScore = Math.min(20, avgSentLen * 0.5) + longSentCount * 4

  let rareCount = 0, discourseCount = 0, highSylWords = 0, totalSyllables = 0
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z]/g, "")
    if (RARE_WORDS.has(clean)) rareCount++
    if (DISCOURSE_MARKERS.has(clean)) discourseCount++
    const s = syllableCount(clean)
    totalSyllables += s
    if (s >= 4) highSylWords++
  }
  const rareRatio = rareCount / totalWords
  const highSylRatio = highSylWords / totalWords
  const avgSyl = totalSyllables / totalWords

  const lexicalScore =
    rareCount * 5 +
    Math.min(25, rareRatio * 120) +
    Math.min(15, highSylRatio * 80) +
    Math.min(10, (avgSyl - 1.3) * 20)

  let embedCount = 0, passiveCount = 0, negCount = 0
  for (const sent of sentences) {
    const ec = (sent.match(EMBEDDERS) || []).length
    const pc = (sent.match(PASSIVES) || []).length
    const nc = (sent.match(NEGATIONS) || []).length
    embedCount += ec
    passiveCount += pc
    negCount += nc
    if (ec > 2) embedCount += (ec - 2) * 2
  }
  const sentLens = sentences.map((s) => s.split(/\s+/).length)
  const meanLen = sentLens.reduce((a, b) => a + b, 0) / Math.max(sentLens.length, 1)
  const variance = sentLens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / Math.max(sentLens.length, 1)
  const stdDev = Math.sqrt(variance)

  const syntaxScore =
    Math.min(30, embedCount * 3.5) +
    Math.min(10, passiveCount * 2.5) +
    Math.min(8, negCount * 1.5) +
    Math.min(8, stdDev * 0.8)

  const anaphoraCount = (text.match(ANAPHORA) || []).length
  const interruptionCount = (text.match(INTERRUPTIONS) || []).length
  const lengthFactor = Math.log2(totalWords + 1) / 4

  const memoryScore =
    Math.min(20, anaphoraCount * 0.4 * lengthFactor) +
    Math.min(15, interruptionCount * 4)

  const abstractCount = (text.match(ABSTRACT_SUFFIX) || []).length
  const abstractDensity = abstractCount / totalWords

  const discourseScore =
    Math.min(15, discourseCount * 4) + Math.min(10, abstractDensity * 60)

  const raw =
    Math.pow(Math.max(0, syntaxScore), 1.35) * 0.30 +
    Math.pow(Math.max(0, lexicalScore), 1.25) * 0.28 +
    Math.pow(Math.max(0, memoryScore), 1.40) * 0.22 +
    Math.pow(Math.max(0, discourseScore), 1.20) * 0.12 +
    Math.pow(Math.max(0, surfaceScore), 0.85) * 0.08

  const score = Math.min(100, Math.round(Math.pow(raw / 8, 0.72) * 10))

  let level: "low" | "medium" | "high"
  let details: string
  if (score < 25) {
    level = "low"
    details = "Easy to read — suitable for all audiences"
  } else if (score < 50) {
    level = "medium"
    details = "Moderate complexity — may need simplification for general audiences"
  } else if (score < 75) {
    level = "high"
    details = "Complex — consider simplification or chunking into shorter sections"
  } else {
    level = "high"
    details = "Very high cognitive demand — specialist audience or needs heavy revision"
  }
  return { level, score, details }
}

export function CognitiveLoadIndicator({ text }: { text: string }) {
  const { level, score, details } = calculateLoad(text)
  const colors = {
    low: "bg-green-500",
    medium: "bg-yellow-500",
    high: "bg-red-500",
  }
  const emojis = { low: "✅", medium: "⚠️", high: "❌" }
  return (
    <div className="flex items-center gap-3 p-3 bg-card border rounded-lg">
      <div className="text-2xl" aria-hidden="true">{emojis[level]}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium">Cognitive Load</span>
          <span className="text-xs text-muted-foreground">{score}/100</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${colors[level]} transition-all duration-500`}
            style={{ width: `${score}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{details}</p>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Export accessible formats — unchanged
 * ─────────────────────────────────────────────────────────────────────────── */

export function ExportAccessibleFormats({
  content,
}: {
  content: {
    original: string
    simplified: string
    translations?: Record<
      string,
      { text: string; native_name: string; language_code: string; audio?: string }
    >
  }
}) {
  const [exporting, setExporting] = useState(false)

  const exportAs = async (format: "txt" | "html" | "rtf") => {
    setExporting(true)
    try {
      let blob: Blob
      let filename: string
      switch (format) {
        case "txt": {
          const txt = `ACCESSIBLE CONTENT EXPORT
========================

ORIGINAL TEXT:
${content.original}

SIMPLIFIED VERSION:
${content.simplified}

${
  content.translations
    ? `TRANSLATIONS:
${Object.entries(content.translations)
  .map(
    ([lang, trans]) => `\n${trans.native_name || lang}:\n${trans.text}`
  )
  .join("\n")}`
    : ""
}`
          blob = new Blob([txt], { type: "text/plain" })
          filename = "accessible-content.txt"
          break
        }
        case "html": {
          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessible Content</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=OpenDyslexic&display=swap');
    body {
      font-family: 'OpenDyslexic', Arial, sans-serif;
      font-size: 18px;
      line-height: 1.8;
      letter-spacing: 0.05em;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #fafafa;
      color: #333;
    }
    h1, h2 { color: #2563eb; }
    .original { background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .simplified { background: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .translation { background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>Accessible Content</h1>

  <h2>Original Text</h2>
  <div class="original" aria-label="Original text"><p>${content.original}</p></div>

  <h2>Simplified Version</h2>
  <div class="simplified" aria-label="Simplified text"><p>${content.simplified}</p></div>

  ${
    content.translations
      ? `<h2>Translations</h2>${Object.entries(content.translations)
          .map(
            ([lang, trans]) => `
  <div class="translation" lang="${trans.language_code}">
    <h3>${trans.native_name || lang}</h3>
    <p>${trans.text}</p>
  </div>`
          )
          .join("")}`
      : ""
  }
</body>
</html>`
          blob = new Blob([html], { type: "text/html" })
          filename = "accessible-content.html"
          break
        }
        case "rtf": {
          const rtf = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\fswiss Arial;}}
{\\colortbl;\\red0\\green0\\blue0;\\red37\\green99\\blue235;}
\\viewkind4\\uc1\\pard\\fs28\\b\\cf2 Accessible Content\\b0\\cf1\\fs22\\par
\\par
\\b ORIGINAL TEXT:\\b0\\par
${content.original.replace(/\n/g, "\\par ")}\\par
\\par
\\b SIMPLIFIED VERSION:\\b0\\par
${content.simplified.replace(/\n/g, "\\par ")}\\par
}`
          blob = new Blob([rtf], { type: "application/rtf" })
          filename = "accessible-content.rtf"
          break
        }
        default:
          return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export failed:", error)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => exportAs("txt")} disabled={exporting}>
        📄 Export TXT
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportAs("html")} disabled={exporting}>
        🌐 Export HTML
      </Button>
      <Button variant="outline" size="sm" onClick={() => exportAs("rtf")} disabled={exporting}>
        📝 Export RTF
      </Button>
    </div>
  )
}

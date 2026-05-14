import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Sparkles, Brain, FileText, Library, Headphones } from "lucide-react"

export function LandingHero() {
  return (
    <section
      className="relative py-20 md:py-32 overflow-hidden isolate"
      aria-labelledby="hero-heading"
    >
      {/* Animated gradient blobs */}
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 right-1/4 h-112 w-md rounded-full bg-primary/25 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 -left-32 h-88 w-88 rounded-full bg-purple-500/20 blur-3xl animate-pulse [animation-delay:1.5s]" />
        <div className="absolute -bottom-24 right-1/3 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl animate-pulse [animation-delay:3s]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_30%,var(--background)_75%)]" />
      </div>

      <div className="container relative px-4 md:px-6">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto gap-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide uppercase text-primary">
              Multimodal · RAG + CAG · UDL
            </span>
          </div>

          <h1
            id="hero-heading"
            className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-foreground text-balance leading-[1.05]"
          >
            Accessible learning,{" "}
            <span className="bg-linear-to-r from-primary via-purple-500 to-pink-500 bg-clip-text text-transparent">
              powered by AI
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl text-pretty leading-relaxed">
            Upload any document, image, audio, or video. NovaPulse turns it into simplified text,
            translations, captions, alt-text, and a searchable knowledge base — then quizzes you on it.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" asChild className="gap-2 shadow-lg shadow-primary/20">
              <Link href="/upload">
                Start converting
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="gap-2 backdrop-blur-sm">
              <Link href="#principles">
                <Brain className="h-4 w-4" aria-hidden="true" />
                See how it works
              </Link>
            </Button>
          </div>

          {/* Feature pills below CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {[
              { icon: FileText, label: "Multimodal ingest" },
              { icon: Sparkles, label: "Grounded Q&A" },
              { icon: Library, label: "Personal library" },
              { icon: Headphones, label: "Voice + audio" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card/60 border border-border/70 backdrop-blur-sm text-xs text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>

          {/* Stat row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 pt-12 mt-4 border-t border-border/70 w-full">
            {[
              { value: "10+", label: "AI models", sub: "Groq, Florence-2, MiniLM" },
              { value: "40+", label: "Languages", sub: "with TTS audio" },
              { value: "4", label: "Study modes", sub: "Ask · Quiz · Flash · Summarise" },
              { value: "100%", label: "Accessible", sub: "UDL-aligned by design" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold bg-linear-to-br from-primary to-purple-500 bg-clip-text text-transparent">
                  {stat.value}
                </div>
                <div className="text-sm font-medium text-foreground mt-1">{stat.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

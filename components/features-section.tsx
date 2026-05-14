import { Card, CardContent } from "@/components/ui/card"
import {
  FileText,
  Languages,
  ImageIcon,
  Mic,
  Shield,
  Brain,
  Lightbulb,
  Layers,
  BookOpen,
  Library,
  Hand,
  BarChart,
} from "lucide-react"

type Feature = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  accent: "indigo" | "emerald" | "rose" | "amber" | "violet" | "sky" | "cyan" | "fuchsia"
}

const PREPROCESSING: Feature[] = [
  {
    icon: FileText,
    title: "Text simplification",
    description: "Groq Llama 3.3 rewrites complex passages at a Grade-8 reading level in under 2 seconds.",
    accent: "indigo",
  },
  {
    icon: Languages,
    title: "40+ language translations",
    description: "Translate with native names and free TTS audio for auditory learners and ESL students.",
    accent: "emerald",
  },
  {
    icon: ImageIcon,
    title: "Alt-text + OCR",
    description: "Florence-2 captions images, Tesseract reads embedded text — screen-reader ready.",
    accent: "rose",
  },
  {
    icon: Mic,
    title: "Speaker-diarised transcripts",
    description: "AssemblyAI converts audio and video into who-said-what transcripts with timestamps.",
    accent: "amber",
  },
  {
    icon: Shield,
    title: "Bias + toxicity detection",
    description: "Rule-based + ML + contextual NER catches gender, age, racial, and academic-elitism bias.",
    accent: "fuchsia",
  },
  {
    icon: Hand,
    title: "Sign-language gloss",
    description: "ASL gloss representation generated from simplified text for deaf accessibility.",
    accent: "cyan",
  },
  {
    icon: BarChart,
    title: "Semantic-similarity score",
    description: "Verifies the simplified version preserves the original meaning, with a 0-1 score.",
    accent: "sky",
  },
]

const STUDY_TOOLS: Feature[] = [
  {
    icon: Brain,
    title: "Grounded Q&A",
    description: "RAG + CAG over your library. Every answer cites the chunks it came from — no hallucinations.",
    accent: "indigo",
  },
  {
    icon: Lightbulb,
    title: "Auto-generated quiz",
    description: "5 MCQs with explanations. Pick a wrong answer? Groq diagnoses the misconception and teaches.",
    accent: "amber",
  },
  {
    icon: Layers,
    title: "3D flashcards",
    description: "Flip-card deck of 8 key terms with keyboard navigation. Spaced-repetition study, built in.",
    accent: "rose",
  },
  {
    icon: BookOpen,
    title: "Multi-length summaries",
    description: "Pick short / medium / detailed. The summary streams in live, grounded in the full document.",
    accent: "emerald",
  },
  {
    icon: Library,
    title: "Personal library",
    description: "Per-user Pinecone namespace. Index every doc you process and search across them later.",
    accent: "violet",
  },
  {
    icon: Mic,
    title: "Voice-first interface",
    description: "Click the mic to ask by voice; answers stream back as both text and speech. Eyes-free study.",
    accent: "sky",
  },
]

const ACCENT_STYLES: Record<Feature["accent"], { ring: string; iconBg: string; iconText: string; glow: string }> = {
  indigo:  { ring: "hover:border-indigo-500/40",  iconBg: "bg-indigo-500/10",  iconText: "text-indigo-600 dark:text-indigo-400",   glow: "from-indigo-500/10" },
  emerald: { ring: "hover:border-emerald-500/40", iconBg: "bg-emerald-500/10", iconText: "text-emerald-600 dark:text-emerald-400", glow: "from-emerald-500/10" },
  rose:    { ring: "hover:border-rose-500/40",    iconBg: "bg-rose-500/10",    iconText: "text-rose-600 dark:text-rose-400",       glow: "from-rose-500/10" },
  amber:   { ring: "hover:border-amber-500/40",   iconBg: "bg-amber-500/10",   iconText: "text-amber-700 dark:text-amber-300",     glow: "from-amber-500/10" },
  violet:  { ring: "hover:border-violet-500/40",  iconBg: "bg-violet-500/10",  iconText: "text-violet-600 dark:text-violet-400",   glow: "from-violet-500/10" },
  sky:     { ring: "hover:border-sky-500/40",     iconBg: "bg-sky-500/10",     iconText: "text-sky-600 dark:text-sky-400",         glow: "from-sky-500/10" },
  cyan:    { ring: "hover:border-cyan-500/40",    iconBg: "bg-cyan-500/10",    iconText: "text-cyan-600 dark:text-cyan-400",       glow: "from-cyan-500/10" },
  fuchsia: { ring: "hover:border-fuchsia-500/40", iconBg: "bg-fuchsia-500/10", iconText: "text-fuchsia-600 dark:text-fuchsia-400", glow: "from-fuchsia-500/10" },
}

function FeatureCard({ feature }: { feature: Feature }) {
  const a = ACCENT_STYLES[feature.accent]
  return (
    <Card
      className={`group relative bg-card border-border/70 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 ${a.ring}`}
    >
      {/* Soft accent glow on hover */}
      <div
        className={`absolute inset-0 rounded-xl bg-linear-to-br ${a.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}
        aria-hidden="true"
      />
      <CardContent className="relative p-5 space-y-3">
        <div
          className={`w-11 h-11 rounded-xl ${a.iconBg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}
        >
          <feature.icon className={`h-5 w-5 ${a.iconText}`} aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-foreground leading-tight">{feature.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
      </CardContent>
    </Card>
  )
}

function FeatureBlock({
  eyebrow,
  title,
  description,
  features,
}: {
  eyebrow: string
  title: string
  description: string
  features: Feature[]
}) {
  return (
    <div className="space-y-8">
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-block text-xs font-semibold tracking-wide uppercase text-primary mb-3 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
          {eyebrow}
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">{title}</h2>
        <p className="text-base md:text-lg text-muted-foreground mt-3 leading-relaxed">{description}</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {features.map((f) => (
          <FeatureCard key={f.title} feature={f} />
        ))}
      </div>
    </div>
  )
}

export function FeaturesSection() {
  return (
    <section className="py-20 md:py-24" aria-labelledby="features-heading">
      <div className="container px-4 md:px-6 space-y-24">
        <h2 id="features-heading" className="sr-only">Platform features</h2>

        <FeatureBlock
          eyebrow="Stage 1 · Preprocessing"
          title="Multimodal in, accessible out"
          description="Drop in text, PDF, image, audio, or video. NovaPulse extracts, simplifies, translates, captions, and screens for bias — automatically."
          features={PREPROCESSING}
        />

        <FeatureBlock
          eyebrow="Stage 2 · AI Study Tools"
          title="Then turn it into a learning experience"
          description="Once your content is indexed, ask questions, generate quizzes, build flashcards, and summarise — all grounded in your own documents, never hallucinated."
          features={STUDY_TOOLS}
        />
      </div>
    </section>
  )
}

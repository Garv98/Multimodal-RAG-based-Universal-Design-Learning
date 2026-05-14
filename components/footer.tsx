import Link from "next/link"
import { Accessibility, Github, Heart } from "lucide-react"

export function Footer() {
  return (
    <footer className="relative border-t border-border/70 bg-card/30 backdrop-blur-sm">
      <div className="container px-4 md:px-6 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/30 blur-md rounded-full" aria-hidden="true" />
              <Accessibility className="relative h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-foreground">
                Nova<span className="text-primary">Pulse</span>
              </p>
              <p className="text-[11px] text-muted-foreground">Multimodal · RAG/CAG · UDL</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm" aria-label="Footer navigation">
            <Link href="/upload" className="text-muted-foreground hover:text-foreground transition-colors">Upload</Link>
            <Link href="/library" className="text-muted-foreground hover:text-foreground transition-colors">Library</Link>
            <Link href="/video" className="text-muted-foreground hover:text-foreground transition-colors">Video</Link>
            <Link href="/results" className="text-muted-foreground hover:text-foreground transition-colors">Results</Link>
            <a
              href="https://github.com/Garv98/Multimodal-RAG-based-Universal-Design-Learning"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
        
              GitHub
            </a>
          </nav>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            © {new Date().getFullYear()} Team NovaPulse
          </p>
        </div>
      </div>
    </footer>
  )
}

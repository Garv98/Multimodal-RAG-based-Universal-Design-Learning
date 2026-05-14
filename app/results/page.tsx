import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { ResultsDashboard } from "@/components/results-dashboard"
import { AuthGate } from "@/components/auth-gate"

export default function ResultsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 py-12">
        <div className="container px-4 md:px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Accessibility Results</h1>
              <p className="text-lg text-muted-foreground">
                Review the AI-generated accessibility transformations and reports.
              </p>
            </div>
            <AuthGate
              title="Sign in to view results"
              description="Results are tied to the document you just processed in your personal library. Sign in to see them and to ask follow-up questions."
            >
              <ResultsDashboard />
            </AuthGate>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}

"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"

/**
 * Error boundary for /agent-builder. Captures to Sentry and offers
 * either a retry or a navigation back to the dashboard.
 */
export default function AgentBuilderError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    const Sentry = (typeof window !== "undefined" && (window as any).Sentry) || null
    if (Sentry && typeof Sentry.captureException === "function") {
      Sentry.captureException(error, { tags: { boundary: "agent-builder" } })
    } else {
      // eslint-disable-next-line no-console
      console.error("[agent-builder/error]", error)
    }
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Workflow builder failed to load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The visual workflow builder hit an error. Your saved workflows
            are safe — this is just a render failure.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-muted-foreground/70 font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={reset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
          <Button variant="outline" onClick={() => router.push("/my-agents")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            My agents
          </Button>
        </div>
      </div>
    </main>
  )
}
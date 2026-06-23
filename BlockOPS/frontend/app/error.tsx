"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw, Home } from "lucide-react"
import { initSentryBrowser } from "@/lib/sentry"

/**
 * Root error boundary for the App Router.
 *
 * Catches any error that bubbles out of a child route or layout. The
 * Sentry SDK is initialised here (idempotent) so we capture the
 * exception even when the error originates in a layout that crashed
 * before `Providers` mounted.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    initSentryBrowser()
    const Sentry = (typeof window !== "undefined" && (window as any).Sentry) || null
    if (Sentry && typeof Sentry.captureException === "function") {
      Sentry.captureException(error, { tags: { boundary: "app-root" } })
    } else {
      // eslint-disable-next-line no-console
      console.error("[app/error]", error)
    }
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-muted-foreground">
            We&rsquo;ve been notified. Please try again, or head back to the
            landing page.
          </p>
          {error.digest && (
            <p className="mt-3 text-xs text-muted-foreground/70 font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={reset} variant="default">
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <Home className="w-4 h-4 mr-2" />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
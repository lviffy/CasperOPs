"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw } from "lucide-react"

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    const Sentry = (typeof window !== "undefined" && (window as any).Sentry) || null
    if (Sentry && typeof Sentry.captureException === "function") {
      Sentry.captureException(error, { tags: { boundary: "marketplace" } })
    } else {
      // eslint-disable-next-line no-console
      console.error("[marketplace/error]", error)
    }
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Marketplace is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&rsquo;t load the agent directory. Try again in a
            moment.
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
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
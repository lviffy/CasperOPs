"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react"

/**
 * Error boundary for /contract-explorer.
 */
export default function ContractExplorerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    const Sentry = (typeof window !== "undefined" && (window as any).Sentry) || null
    if (Sentry && typeof Sentry.captureException === "function") {
      Sentry.captureException(error, { tags: { boundary: "contract-explorer" } })
    } else {
      // eslint-disable-next-line no-console
      console.error("[contract-explorer/error]", error)
    }
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
          <AlertCircle className="w-7 h-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Contract explorer failed to load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&rsquo;t fetch the on-chain state. The Casper RPC
            might be unreachable; check the network status.
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
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
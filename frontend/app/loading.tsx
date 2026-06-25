import { Loader2 } from "lucide-react"

/**
 * Root loading state for the App Router. Shown automatically by Next.js
 * while a server component or layout is suspending. The skeleton here
 * is intentionally simple — interactive pages opt into a richer
 * `loading.tsx` per route.
 */
export default function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading CasperOPs…</p>
      </div>
    </main>
  )
}
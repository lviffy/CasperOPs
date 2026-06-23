import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading skeleton for /contract-explorer. Mirrors the real layout
 * (header, search row, contract cards) so the page doesn't flash.
 */
export default function ContractExplorerLoading() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 lg:py-14 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    </main>
  )
}
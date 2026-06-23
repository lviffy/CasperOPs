import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading state for the visual workflow builder. Renders a faux
 * toolbar + canvas skeleton so the page doesn't flash to a blank
 * screen while ReactFlow mounts.
 */
export default function AgentBuilderLoading() {
  return (
    <main className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r p-4 space-y-3">
          <Skeleton className="h-5 w-24 mb-4" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </aside>
        <div className="flex-1 grid place-items-center bg-muted/30">
          <Skeleton className="h-48 w-72 rounded-lg" />
        </div>
      </div>
    </main>
  )
}
import { Skeleton } from "@/components/ui/skeleton"

export default function AgentChatLoading() {
  return (
    <main className="flex h-screen flex-col">
      <div className="border-b px-4 py-3 flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex-1 p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className={`h-12 w-${i % 2 === 0 ? '2/3' : '1/2'}`} />
        ))}
      </div>
      <div className="border-t p-4 flex items-center gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-20" />
      </div>
    </main>
  )
}
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"
import WorkflowBuilder from "@/components/workflow-builder"
import { useAuth } from "@/lib/auth"
import { PrivateKeySetupModal } from "@/components/private-key-setup-modal"
import { Loader2 } from "lucide-react"

function AgentBuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const agentId = searchParams.get("agent")
  const { ready, authenticated, loading, user, showPrivateKeySetup, setShowPrivateKeySetup, syncUser, pkpSchemaReady } = useAuth()

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace("/")
    }
  }, [ready, authenticated, router])

  if (!ready || loading) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-foreground mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </main>
    )
  }

  if (!authenticated) {
    return null // Will redirect
  }

  // Debug logging
  console.log('Agent Builder - Modal Props:', { authenticated, hasUser: !!user, showPrivateKeySetup })

  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex-1">
        <WorkflowBuilder agentId={agentId || undefined} />
      </div>

      {/* Private Key Setup Modal */}
      {authenticated && user && (
        <PrivateKeySetupModal
          open={showPrivateKeySetup}
          onOpenChange={setShowPrivateKeySetup}
          userId={user.id}
          onComplete={syncUser}
          pkpSchemaReady={pkpSchemaReady}
        />
      )}
    </main>
  )
}

export default function AgentBuilder() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen flex-col items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-foreground mx-auto" />
            <p className="mt-4 text-muted-foreground">Loading...</p>
          </div>
        </main>
      }
    >
      <AgentBuilderContent />
    </Suspense>
  )
}

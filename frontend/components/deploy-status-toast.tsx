"use client"

/**
 * Deploy-status toast: tracks a Casper deploy through pending → executed →
 * finalized and updates the toast in-place. Polls the JSON-RPC
 * `info_get_deploy` endpoint every 2 s for up to 120 s.
 *
 * Usage:
 *   const { trackingToast, dismiss } = useDeployStatusToast();
 *   trackingToast({ deployHash, label: "register_agent" });
 *   ...
 *   dismiss(); // optional, called automatically once finalized
 */

import { useCallback, useRef, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react"
import { casperDeployUrl } from "@/lib/wallet"
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from "@/lib/chains"

type DeployStatus = "pending" | "executed" | "finalized" | "failed"

interface DeployTrackingState {
  deployHash: string
  label: string
  status: DeployStatus
  message?: string
}

interface TrackingToastOptions {
  deployHash: string
  label: string
  /** Optional CSPR.click-style error message that bypasses polling. */
  immediateError?: string
}

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000

async function fetchDeployStatus(deployHash: string, rpcUrl: string): Promise<DeployStatus> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "info_get_deploy",
        params: { deploy_hash: deployHash },
      }),
    })
    if (!res.ok) return "pending"
    const json: any = await res.json()
    const exec = json?.result?.execution_results?.[0]
    if (!exec) return "pending"
    if (exec.error_message) return "failed"
    const block = json?.result?.execution_results?.length ?? 1
    // Casper returns multiple execution_results when the deploy is included
    // in a finalized block. Treat ≥2 as "finalized".
    return block > 1 ? "finalized" : "executed"
  } catch {
    return "pending"
  }
}

export function useDeployStatusToast() {
  const { toast, dismiss } = useToast()
  const stateRef = useRef<DeployTrackingState | null>(null)
  const toastIdRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState<DeployTrackingState | null>(null)

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const update = useCallback(
    (status: DeployStatus, message?: string) => {
      if (!stateRef.current) return
      stateRef.current = { ...stateRef.current, status, message }
      setActive({ ...stateRef.current })
      if (toastIdRef.current) {
        dismiss(toastIdRef.current)
        toastIdRef.current = null
      }
      const id = showStatusToast({
        ...stateRef.current,
      })
      toastIdRef.current = id
    },
    [toast, dismiss],
  )

  const trackingToast = useCallback(
    ({ deployHash, label, immediateError }: TrackingToastOptions) => {
      stop()
      stateRef.current = {
        deployHash,
        label,
        status: "pending",
        message: "Submitted to Casper network…",
      }
      setActive({ ...stateRef.current })
      const id = showStatusToast({ ...stateRef.current })
      toastIdRef.current = id

      if (immediateError) {
        update("failed", immediateError)
        stop()
        return
      }

      const rpc = CHAIN_CONFIGS[DEFAULT_CHAIN_ID].rpcUrl
      const tick = async () => {
        if (!stateRef.current) return
        const status = await fetchDeployStatus(deployHash, rpc)
        if (status === stateRef.current.status) return
        if (status === "pending") return
        if (status === "failed") {
          update("failed", "Deploy reverted on chain.")
        } else if (status === "executed") {
          update("executed", "Included in a block. Waiting for finality…")
        } else if (status === "finalized") {
          update("finalized", "Finalized on the Casper network.")
        }
        if (status === "finalized" || status === "failed") {
          stop()
        }
      }

      intervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
      timeoutRef.current = setTimeout(() => {
        stop()
        if (stateRef.current && stateRef.current.status === "pending") {
          update("pending", "Still pending after 2 min — check the explorer for details.")
        }
      }, POLL_TIMEOUT_MS)
    },
    [toast, dismiss, stop, update],
  )

  return { trackingToast, activeTracking: active, stopTracking: stop }
}

function showStatusToast(state: DeployTrackingState): string {
  const { id } = toast({
    title: deployTitle(state),
    description: deployDescription(state),
    action: deployAction(state),
    duration: state.status === "finalized" || state.status === "failed" ? 8000 : Number.MAX_SAFE_INTEGER,
  })
  return id
}

function deployTitle(state: DeployTrackingState): string {
  if (state.status === "pending") return `${state.label} — pending`
  if (state.status === "executed") return `${state.label} — included in block`
  if (state.status === "finalized") return `${state.label} — finalized`
  return `${state.label} — failed`
}

function deployDescription(state: DeployTrackingState): string {
  return state.message ?? "Awaiting confirmation…"
}

function deployAction(state: DeployTrackingState) {
  return (
    <Button asChild variant="outline" size="sm" className="gap-1">
      <a href={casperDeployUrl(state.deployHash)} target="_blank" rel="noreferrer">
        <ExternalLink className="h-3 w-3" /> View deploy
      </a>
    </Button>
  )
}

export function DeployStatusIndicator({ status }: { status: DeployStatus }) {
  if (status === "pending" || status === "executed") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  }
  if (status === "finalized") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  }
  return <XCircle className="h-3.5 w-3.5 text-destructive" />
}

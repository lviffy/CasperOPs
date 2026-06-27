"use client"

import { useEffect, useState, useCallback } from "react"
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  Copy,
  FileJson,
  Globe,
  Loader2,
  Search,
  ShieldCheck,
  Star,
  ArrowUpDown,
  ArrowDownAZ,
  HandCoins,
  ExternalLink,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { UserProfile } from "@/components/user-profile"
import { useAuth } from "@/lib/auth"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BLOCKCHAIN_BACKEND_URL } from "@/lib/backend"
import { getAgentById } from "@/lib/agents"
import { initCsprClick, getActiveAccount, sendDeploy } from "@/lib/wallet"
import { toast } from "@/components/ui/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type AgentManifest = {
  name?: string
  version?: string
  description?: string
  author?: string
  capabilities?: string[]
  paymentProtocol?: string
  erc8004?: {
    identityRegistry?: string
    reputationRegistry?: string
    validationRegistry?: string
    agentId?: string | number
    operatorWallet?: string
  }
  chain?: {
    name?: string
    chainId?: number
  }
}

type MarketplaceAgent = {
  id: string
  localAgentId: string | null
  name: string
  description: string
  onChainId: string
  score: number
  executions: number
  capabilities: string[]
  owner: string
  price: string
  manifest: AgentManifest
  ownerLabel: string
  detailSummary: string
}

const CASPER_NETWORK = "casper-testnet"
const AGENT_REGISTRY_CONTRACT_HASH =
  process.env.NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH || ""
const REPUTATION_CONTRACT_HASH =
  process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_HASH || ""
const VALIDATION_CONTRACT_HASH =
  process.env.NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH || ""
const CSPR_CLOUD_BASE = "https://node.cspr.cloud"

interface CasperEvent {
  contractHash: string
  entryPoint: string
  data: Record<string, unknown>
}

interface CasperAgentSummary {
  onChainId: string
  owner: string
  manifestUri: string
  score: number
  executions: number
}

async function fetchCasperAgents(): Promise<CasperAgentSummary[]> {
  try {
    const url = `${BLOCKCHAIN_BACKEND_URL}/agents/registry/discover?limit=100`
    const res = await fetch(url, { headers: { accept: "application/json" } })
    if (!res.ok) return []
    const json = await res.json().catch(() => null)
    const items = json?.registry ?? []
    
    return items.map((item: any) => {
      const agentId = item.agentId || item.id || ""
      const onChainId = item.metadata?.onChainId || item.metadata?.on_chain_id || agentId
      const owner = item.metadata?.operatorWallet || item.userId || ""
      const manifestUri = `${BLOCKCHAIN_BACKEND_URL}/agents/${agentId}/manifest`
      const score = Number(item.metadata?.score ?? 5.0)
      const executions = Number(item.metadata?.executions ?? 1)
      return { onChainId, owner, manifestUri, score, executions } satisfies CasperAgentSummary
    })
  } catch (err) {
    console.warn("[marketplace] Discovery fetch failed:", err)
    return []
  }
}

function parseLocalAgentIdFromUri(manifestUri: string) {
  const match = manifestUri.match(/\/agents\/([^/]+)\/manifest\/?$/i)
  return match?.[1] ?? null
}

async function fetchManifest(manifestUri: string): Promise<AgentManifest | null> {
  if (!/^https?:\/\//i.test(manifestUri)) {
    return null
  }

  try {
    const response = await fetch(manifestUri)
    if (!response.ok) {
      return null
    }

    return response.json()
  } catch {
    return null
  }
}

function shortenAddress(address: string) {
  if (!address || address.length < 10) {
    return address
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function normalizeCapabilities(...sources: Array<string[] | undefined>) {
  const seen = new Set<string>()

  for (const source of sources) {
    for (const value of source || []) {
      const normalized = String(value || "").trim()
      if (normalized) {
        seen.add(normalized)
      }
    }
  }

  return Array.from(seen)
}

function buildFallbackManifest(agent: {
  name: string
  description: string
  onChainId: string
  owner: string
  capabilities: string[]
}) {
  return {
    name: agent.name,
    version: "1.0.0",
    description: agent.description,
    author: "CasperOPs",
    erc8004: {
      identityRegistry: `casper:${CASPER_NETWORK}:contract:${AGENT_REGISTRY_CONTRACT_HASH}`,
      reputationRegistry: `casper:${CASPER_NETWORK}:contract:${REPUTATION_CONTRACT_HASH}`,
      validationRegistry: `casper:${CASPER_NETWORK}:contract:${VALIDATION_CONTRACT_HASH}`,
      agentId: agent.onChainId,
      operatorWallet: agent.owner,
    },
    capabilities: agent.capabilities,
    paymentProtocol: "x402",
    chain: {
      name: "Casper Testnet",
    },
  } satisfies AgentManifest
}

type SortMode = "default" | "top-rated"

export default function MarketplacePage() {
  const { logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<MarketplaceAgent[]>([])
  const [sortMode, setSortMode] = useState<SortMode>("top-rated")
  const [selectedAgentForManifest, setSelectedAgentForManifest] = useState<AgentManifest | null>(null)
  const [manifestDialogOpen, setManifestDialogOpen] = useState(false)
  const [escrowAgent, setEscrowAgent] = useState<MarketplaceAgent | null>(null)
  const [escrowOpen, setEscrowOpen] = useState(false)
  const [escrowAmount, setEscrowAmount] = useState("5")
  const [escrowSigning, setEscrowSigning] = useState(false)
  const [escrowDeployHash, setEscrowDeployHash] = useState<string | null>(null)
  const [escrowedIds, setEscrowedIds] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("escrowed-agents")
      return stored ? new Set(JSON.parse(stored)) : new Set()
    }
    return new Set()
  })

  // Initialize CSPR.click
  useEffect(() => {
    initCsprClick()
  }, [])

  const handleEscrow = useCallback(async () => {
    if (!escrowAgent) return
    setEscrowSigning(true)
    setEscrowDeployHash(null)
    try {
      const account = await getActiveAccount()
      if (!account?.publicKey) {
        toast({ title: "Wallet required", description: "Please connect CSPR.click first", variant: "destructive" })
        return
      }
      const amountMotes = Math.round(parseFloat(escrowAmount) * 1e9)
      if (isNaN(amountMotes) || amountMotes <= 0) {
        toast({ title: "Invalid amount", description: "Enter a valid CSPR amount", variant: "destructive" })
        return
      }
      const deployJson = {
        deploy: {
          header: { ttl: "30m", gas_price: 1 },
          payment: { amount: amountMotes.toString() },
          session: {
            entry_point: "deposit",
            args: [
              ["agent_id", { bytes: escrowAgent.onChainId, cl_type: "string" }],
              ["amount", { bytes: amountMotes.toString(), cl_type: "u512" }],
            ],
          },
        },
      }
      const result = await sendDeploy(deployJson, account.publicKey) as any
      const hash = result?.deployHash || result?.hash || ""
      setEscrowDeployHash(hash)
      setEscrowedIds((prev) => {
        const next = new Set(prev)
        next.add(escrowAgent.id)
        sessionStorage.setItem("escrowed-agents", JSON.stringify([...next]))
        return next
      })
      toast({
        title: "Escrow deposit sent!",
        description: `Deploy: ${hash.slice(0, 12)}... on CSPR.live`,
      })
    } catch (err: any) {
      toast({ title: "Escrow deposit failed", description: err?.message || "Unknown error", variant: "destructive" })
    } finally {
      setEscrowSigning(false)
    }
  }, [escrowAgent, escrowAmount])

  useEffect(() => {
    async function fetchOnChainAgents() {
      setLoading(true)
      try {
        const summaries = await fetchCasperAgents()

        const realAgents = await Promise.all(
          summaries.map(async (summary) => {
            const onChainId = summary.onChainId
            const manifestUri = summary.manifestUri
            const localAgentId = parseLocalAgentIdFromUri(manifestUri)

            try {
              const [remoteManifest, localManifest, localAgent, owner, score, executions] = await Promise.all([
                fetchManifest(manifestUri),
                localAgentId ? fetchManifest(`${BLOCKCHAIN_BACKEND_URL}/agents/${localAgentId}/manifest`) : Promise.resolve(null),
                localAgentId ? getAgentById(localAgentId) : Promise.resolve(null),
                Promise.resolve(summary.owner),
                Promise.resolve(summary.score),
                Promise.resolve(summary.executions),
              ])

              const manifest = localManifest || remoteManifest
              const localToolCapabilities = Array.isArray(localAgent?.tools)
                ? localAgent.tools.map((tool) => tool.tool).filter(Boolean)
                : []
              const capabilities = normalizeCapabilities(
                Array.isArray(localManifest?.capabilities) ? localManifest.capabilities : undefined,
                Array.isArray(remoteManifest?.capabilities) ? remoteManifest.capabilities : undefined,
                localToolCapabilities
              )
              const name =
                localAgent?.name?.trim() ||
                localManifest?.name?.trim() ||
                remoteManifest?.name?.trim() ||
                `Agent #${onChainId}`
              const description =
                localAgent?.description?.trim() ||
                localManifest?.description?.trim() ||
                remoteManifest?.description?.trim() ||
                "Casper-registered agent"
              const price = manifest?.paymentProtocol ? String(manifest.paymentProtocol).toUpperCase() : "Varies"
              const ownerLabel = shortenAddress(owner)
              const detailSummary =
                capabilities.length > 0
                  ? `${capabilities.length} ${capabilities.length === 1 ? "capability" : "capabilities"} available`
                  : localAgentId
                    ? "Registered CasperOPs agent"
                    : "On-chain registered agent"

              return {
                id: localAgentId || onChainId,
                localAgentId,
                name,
                description,
                onChainId,
                score: Number(score),
                executions: Number(executions),
                capabilities,
                owner,
                price,
                manifest: manifest || buildFallbackManifest({
                  name,
                  description,
                  onChainId,
                  owner,
                  capabilities,
                }),
                ownerLabel,
                detailSummary,
              } satisfies MarketplaceAgent
            } catch {
              return null
            }
          })
        )

        setAgents(realAgents.filter((agent): agent is MarketplaceAgent => agent !== null))
      } catch (error) {
        console.error("Error fetching on-chain data:", error)
        setAgents([])
      } finally {
        setLoading(false)
      }
    }

    fetchOnChainAgents()
  }, [])

  const filteredAgents = agents
    .filter((agent) =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.capabilities.some((capability) => capability.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      if (sortMode === "top-rated") return b.score - a.score
      return b.executions - a.executions
    })

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
                <Bot className="h-5 w-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">CasperOPs</span>
            </Link>
            <Separator orientation="vertical" className="mx-2 h-6" />
            <Badge variant="outline" className="text-xs font-medium">
              Marketplace
            </Badge>
          </div>
          <UserProfile onLogout={logout} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">Marketplace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Discover agents registered on-chain on Casper Network.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs font-medium">
            <Link href="/agent-builder">Build Agent</Link>
          </Button>
        </div>

        <div className="mt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, capability, or description..."
              className="h-10 pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{filteredAgents.length} registered agent{filteredAgents.length === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortMode("top-rated")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                sortMode === "top-rated"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Star className="h-3 w-3" />
              Top Rated
            </button>
            <button
              onClick={() => setSortMode("default")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                sortMode === "default"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <ArrowDownAZ className="h-3 w-3" />
              Most Used
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredAgents.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredAgents.map((agent) => (
              <Card key={agent.id} className="border-border bg-background shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                        <Bot className="h-4 w-4 text-foreground/70" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-medium">{agent.name}</CardTitle>
                          <ShieldCheck className="h-4 w-4 text-primary" />
                        </div>
                        <CardDescription className="mt-1 line-clamp-2 text-sm leading-relaxed">
                          {agent.description}
                        </CardDescription>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {agent.detailSummary}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground">
                      <Star className="h-3.5 w-3.5 fill-current text-yellow-500" />
                      <span>{agent.score}</span>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pb-4">
                  {agent.capabilities.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {agent.capabilities.map((capability) => (
                        <Badge key={capability} variant="secondary" className="h-6 rounded-md px-2 text-[11px] font-medium">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No capabilities listed in manifest.</p>
                  )}

                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-md border border-border px-3 py-2 min-w-0 overflow-hidden">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Agent ID</div>
                      <div className="flex items-center gap-1.5 text-foreground" title={agent.onChainId}>
                        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono text-[11px]">{shortenAddress(agent.onChainId)}</span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2 min-w-0">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Reputation</div>
                      <div className="text-foreground truncate">{agent.executions} rating{agent.executions === 1 ? "" : "s"}</div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2 min-w-0">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Protocol</div>
                      <div className="text-foreground truncate">{agent.price}</div>
                    </div>
                  </div>

                  <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/70">Owner:</span> {agent.ownerLabel}
                  </div>
                </CardContent>

                <CardFooter className="flex gap-2 pt-0">
                  <Button
                    variant="outline"
                    className="h-9 flex-1 text-xs"
                    onClick={() => {
                      setSelectedAgentForManifest(agent.manifest)
                      setManifestDialogOpen(true)
                    }}
                  >
                    View Manifest
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={escrowedIds.has(agent.id) ? "default" : "secondary"}
                          className={`h-9 flex-1 text-xs ${escrowedIds.has(agent.id) ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                          onClick={() => {
                            if (escrowedIds.has(agent.id)) return
                            setEscrowAgent(agent)
                            setEscrowAmount("5")
                            setEscrowDeployHash(null)
                            setEscrowOpen(true)
                          }}
                          disabled={escrowedIds.has(agent.id)}
                        >
                          <HandCoins className="mr-1.5 h-3.5 w-3.5" />
                          {escrowedIds.has(agent.id) ? "Escrow Active" : "Hire via Escrow"}
                        </Button>
                      </TooltipTrigger>
                      {escrowedIds.has(agent.id) && (
                        <TooltipContent>
                          <p className="text-xs">Escrow deposit active for this agent</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                  {agent.localAgentId ? (
                    <Button className="h-9 flex-1 text-xs" asChild>
                      <Link href={`/agent/${agent.localAgentId}/chat`}>
                        Call Agent
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : (
                    <Button className="h-9 flex-1 text-xs" disabled>
                      On-chain only
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-border bg-background px-6 py-16 text-center">
            <AlertCircle className="mx-auto h-5 w-5 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium text-foreground">No registered agents found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {searchQuery ? "Try a different search term." : "Once agents are registered via the contract, they will appear here."}
            </p>
            {searchQuery ? (
              <Button variant="link" className="mt-2 h-auto p-0 text-sm" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            ) : null}
          </div>
        )}
      </main>

      <Dialog open={escrowOpen} onOpenChange={setEscrowOpen}>
        <DialogContent className="sm:max-w-md border-border">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                <HandCoins className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">Hire via Escrow</DialogTitle>
                <DialogDescription className="text-xs">
                  Deposit CSPR into escrow to hire {escrowAgent?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent</span>
                <span className="font-medium">{escrowAgent?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">On-Chain ID</span>
                <span className="font-mono">{escrowAgent?.onChainId ? escrowAgent.onChainId.slice(0, 16) + "..." : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reputation</span>
                <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />{escrowAgent?.score}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/70">Deposit Amount (CSPR)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={escrowAmount}
                  onChange={(e) => setEscrowAmount(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-foreground/30"
                  placeholder="5"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => setEscrowAmount("5")}
                >
                  5 CSPR
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => setEscrowAmount("10")}
                >
                  10 CSPR
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">The deposit is held in escrow and refunded if the agent fails to execute.</p>
            </div>

            {escrowDeployHash && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                  <Check className="h-3.5 w-3.5" />
                  Escrow deposit sent!
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-emerald-600">{escrowDeployHash.slice(0, 20)}...</span>
                  <a
                    href={`https://testnet.cspr.live/deploy/${escrowDeployHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-emerald-700 hover:underline"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-9 text-xs" onClick={() => setEscrowOpen(false)}>
              {escrowDeployHash ? "Close" : "Cancel"}
            </Button>
            {!escrowDeployHash && (
              <Button
                className="h-9 text-xs"
                onClick={handleEscrow}
                disabled={escrowSigning || !escrowAmount || parseFloat(escrowAmount) <= 0}
              >
                {escrowSigning ? "Signing with CSPR.click..." : `Deposit ${escrowAmount} CSPR`}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manifestDialogOpen} onOpenChange={setManifestDialogOpen}>
        <DialogContent className="max-w-2xl border-border p-0">
          <DialogHeader className="border-b border-border p-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
                <FileJson className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">agent.json</DialogTitle>
                <DialogDescription className="text-xs">
                  Registered manifest for {selectedAgentForManifest?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto p-6">
            <div className="overflow-x-auto rounded-md border border-border bg-muted/20 p-4 font-mono text-xs leading-relaxed">
              <pre className="text-foreground/80">
                {JSON.stringify(selectedAgentForManifest, null, 2)}
              </pre>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Identity</div>
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" />
                  Registered on Casper Testnet
                </div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reputation</div>
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" />
                  Trust score available on-chain
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-border p-4">
            <Button variant="ghost" className="h-9 text-xs" onClick={() => setManifestDialogOpen(false)}>
              Close
            </Button>
            <Button
              className="h-9 gap-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(selectedAgentForManifest, null, 2))
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy JSON
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

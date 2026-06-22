"use client"

import { useEffect, useState } from "react"
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
} from "lucide-react"
import { ethers } from "ethers"
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

const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"
const CHAIN_ID = 421614
const IDENTITY_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS || "0x734C984AE7d64aa917D9D2e4B9C08A0CD6C0589B"
const REPUTATION_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS || "0xa497e1BFe08109D60A8F91AdEc868ffdD1e0055c"
const VALIDATION_REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS || "0xFab8731b8d1a978e78086179dC5494F0dbA1f6bE"

const IDENTITY_ABI = [
  "function tokenURI(uint256 agentId) view returns (string)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)"
]

const REPUTATION_ABI = [
  "function getAverageScore(uint256 agentId, string memory tag) view returns (uint256)",
  "function getSummary(uint256 agentId, string memory tag) view returns (uint256 count, uint256 summaryValue)"
]

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
    author: "BlockOps",
    erc8004: {
      identityRegistry: `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY_ADDRESS}`,
      reputationRegistry: `eip155:${CHAIN_ID}:${REPUTATION_REGISTRY_ADDRESS}`,
      validationRegistry: `eip155:${CHAIN_ID}:${VALIDATION_REGISTRY_ADDRESS}`,
      agentId: agent.onChainId,
      operatorWallet: agent.owner,
    },
    capabilities: agent.capabilities,
    paymentProtocol: "x402",
    chain: {
      name: "Arbitrum Sepolia",
      chainId: CHAIN_ID,
    },
  } satisfies AgentManifest
}

export default function MarketplacePage() {
  const { logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState<MarketplaceAgent[]>([])
  const [selectedAgentForManifest, setSelectedAgentForManifest] = useState<AgentManifest | null>(null)
  const [manifestDialogOpen, setManifestDialogOpen] = useState(false)

  useEffect(() => {
    async function fetchOnChainAgents() {
      setLoading(true)
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        const identityContract = new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_ABI, provider)
        const reputationContract = new ethers.Contract(REPUTATION_REGISTRY_ADDRESS, REPUTATION_ABI, provider)
        const registeredEvents = await identityContract.queryFilter(identityContract.filters.AgentRegistered(), 0, "latest")

        const realAgents = await Promise.all(
          registeredEvents.map(async (event: any) => {
            const onChainId = event.args.agentId.toString()
            const manifestUri = String(event.args.agentURI || "")
            const localAgentId = parseLocalAgentIdFromUri(manifestUri)

            try {
              const [remoteManifest, localManifest, localAgent, owner, score, summary] = await Promise.all([
                fetchManifest(manifestUri),
                localAgentId ? fetchManifest(`${BLOCKCHAIN_BACKEND_URL}/agents/${localAgentId}/manifest`) : Promise.resolve(null),
                localAgentId ? getAgentById(localAgentId) : Promise.resolve(null),
                identityContract.ownerOf(event.args.agentId),
                reputationContract.getAverageScore(event.args.agentId, "successRate"),
                reputationContract.getSummary(event.args.agentId, "successRate"),
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
                "ERC-8004 registered agent"
              const price = manifest?.paymentProtocol ? String(manifest.paymentProtocol).toUpperCase() : "Varies"
              const ownerLabel = shortenAddress(owner)
              const detailSummary =
                capabilities.length > 0
                  ? `${capabilities.length} capability${capabilities.length === 1 ? "" : "ies"} available`
                  : localAgentId
                    ? "Registered BlockOps agent"
                    : "On-chain registered agent"

              return {
                id: localAgentId || onChainId,
                localAgentId,
                name,
                description,
                onChainId,
                score: Number(score),
                executions: Number(summary[0] || 0),
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

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.capabilities.some((capability) => capability.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <div className="min-h-screen bg-background font-aeonik">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
                <Bot className="h-5 w-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">BlockOps</span>
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
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Marketplace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Discover agents registered on-chain via ERC-8004.
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
          <span>Source: Identity Registry</span>
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
                    <div className="rounded-md border border-border px-3 py-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Agent ID</div>
                      <div className="flex items-center gap-2 text-foreground">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{agent.onChainId}</span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Reputation</div>
                      <div className="text-foreground">{agent.executions} rating{agent.executions === 1 ? "" : "s"}</div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/60">Protocol</div>
                      <div className="text-foreground">{agent.price}</div>
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
                  Registered on Arbitrum Sepolia
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

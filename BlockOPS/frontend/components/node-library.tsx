"use client"

import type React from "react"
import {
  ArrowRightLeft,
  Wallet,
  Coins,
  Image as ImageIcon,
  TrendingUp,
  Mail,
  ShieldCheck,
  Star,
  Layers,
  Zap,
  Search,
  Network,
  CheckSquare,
} from "lucide-react"
import { getToolSupportMeta } from "@/lib/tool-support"

// All tools are Casper Network native
const toolTypes = [
  // ── CSPR & Transfers ──────────────────────────────────────
  {
    type: "transfer",
    label: "CSPR Transfer",
    description: "Transfer native CSPR tokens",
    icon: ArrowRightLeft,
    category: "Transfers",
  },
  {
    type: "batch_transfer",
    label: "Batch CSPR Transfer",
    description: "Multi-send CSPR to many wallets",
    icon: ArrowRightLeft,
    category: "Transfers",
  },
  {
    type: "get_balance",
    label: "Get CSPR Balance",
    description: "Fetch wallet CSPR balance",
    icon: Wallet,
    category: "Transfers",
  },

  // ── Token & NFT Deployment ─────────────────────────────────
  {
    type: "deploy_cep18",
    label: "Deploy CEP-18 Token",
    description: "Deploy a Casper fungible token",
    icon: Coins,
    category: "Tokens",
  },
  {
    type: "deploy_cep78",
    label: "Deploy CEP-78 NFT",
    description: "Deploy a Casper NFT collection",
    icon: ImageIcon,
    category: "Tokens",
  },
  {
    type: "mint_nft",
    label: "Mint NFT",
    description: "Mint into a CEP-78 collection",
    icon: Layers,
    category: "Tokens",
  },

  // ── Casper Agent Registry ──────────────────────────────────
  {
    type: "register_agent",
    label: "Register Agent",
    description: "Register an agent on-chain via AgentFactory",
    icon: Network,
    category: "Agents",
  },
  {
    type: "attest_agent",
    label: "Attest Agent (RWA)",
    description: "Submit RWA compliance attestation",
    icon: CheckSquare,
    category: "Agents",
  },
  {
    type: "get_reputation",
    label: "Get Agent Reputation",
    description: "Read on-chain reputation score",
    icon: Star,
    category: "Agents",
  },

  // ── Yield & DeFi ──────────────────────────────────────────
  {
    type: "yield_rebalance",
    label: "Yield Rebalance",
    description: "Rebalance yield vault positions",
    icon: Zap,
    category: "DeFi",
  },

  // ── On-chain Lookups ───────────────────────────────────────
  {
    type: "lookup_deploy",
    label: "Lookup Deploy",
    description: "Check Casper deploy status",
    icon: Search,
    category: "Lookups",
  },
  {
    type: "get_token_info",
    label: "CEP-18 Token Info",
    description: "Get token name, symbol, supply",
    icon: Coins,
    category: "Lookups",
  },
  {
    type: "get_token_balance",
    label: "CEP-18 Token Balance",
    description: "Get CEP-18 balance for an address",
    icon: Wallet,
    category: "Lookups",
  },
  {
    type: "get_nft_info",
    label: "CEP-78 NFT Info",
    description: "Get NFT metadata and owner",
    icon: ImageIcon,
    category: "Lookups",
  },

  // ── Notifications & Utilities ──────────────────────────────
  {
    type: "fetch_price",
    label: "Fetch CSPR Price",
    description: "Live CSPR market price via CSPR.cloud",
    icon: TrendingUp,
    category: "Utilities",
  },
  {
    type: "send_email",
    label: "Send Email",
    description: "Send email notifications",
    icon: Mail,
    category: "Utilities",
  },
  {
    type: "wallet_readiness",
    label: "Wallet Readiness",
    description: "Check if a Casper wallet is funded",
    icon: ShieldCheck,
    category: "Utilities",
  },
]

const categoryOrder = ["Transfers", "Tokens", "Agents", "DeFi", "Lookups", "Utilities"]

export default function NodeLibrary() {
  const onDragStart = (event: React.DragEvent<HTMLDivElement>, toolType: string) => {
    event.dataTransfer.setData("application/reactflow", toolType)
    event.dataTransfer.effectAllowed = "move"
  }

  const grouped = categoryOrder.map((cat) => ({
    category: cat,
    tools: toolTypes.filter((t) => t.category === cat),
  }))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-200">
        <h2 className="text-sm font-medium text-neutral-900 tracking-tight">
          Casper Tools
        </h2>
        <p className="text-xs text-neutral-400 mt-0.5">Drag to add to workflow</p>
      </div>

      {/* Tools List — grouped by category */}
      <div className="flex-1 overflow-y-auto">
        {grouped.map(({ category, tools }) =>
          tools.length === 0 ? null : (
            <div key={category}>
              <div className="px-3 pt-3 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  {category}
                </span>
              </div>
              <div className="px-2 pb-1 space-y-1">
                {tools.map((tool) => {
                  const Icon = tool.icon
                  const supportMeta = getToolSupportMeta(tool.type)
                  return (
                    <div
                      key={tool.type}
                      draggable={true}
                      onDragStart={(e) => onDragStart(e, tool.type)}
                      className="group cursor-grab active:cursor-grabbing px-3 py-2.5 rounded border border-neutral-200 bg-white hover:border-red-300 hover:shadow-sm transition-all duration-150"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-neutral-500 group-hover:text-red-600 transition-colors">
                          <Icon className="h-4 w-4" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-medium text-neutral-900 tracking-tight">
                              {tool.label}
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${supportMeta.className}`}
                            >
                              {supportMeta.label}
                            </span>
                          </div>
                          <div className="text-xs text-neutral-500 mt-0.5">
                            {tool.description}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50">
        <p className="text-xs text-neutral-500 leading-relaxed">
          ⛓ Powered by Casper Network · Odra Contracts
        </p>
      </div>
    </div>
  )
}

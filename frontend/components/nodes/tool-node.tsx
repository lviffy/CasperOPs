"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "reactflow"
import {
  ArrowRightLeft,
  Wallet,
  Coins,
  Image as ImageIcon,
  Layers,
  TrendingUp,
  Mail,
  ShieldCheck,
  Star,
  Zap,
  Search,
  Network,
  CheckSquare,
  Calculator,
  MessageSquare,
  Sliders,
  ArrowUpCircle,
  FileText,
  Key,
  Activity,
  Award,
} from "lucide-react"
import type { NodeData } from "@/lib/types"
import { getToolSupportMeta } from "@/lib/tool-support"
import { getToolPrice } from "@/lib/tool-pricing"

const toolIcons: Record<string, React.ReactNode> = {
  // Native CSPR
  transfer: <ArrowRightLeft className="h-4 w-4" />,
  batch_transfer: <ArrowRightLeft className="h-4 w-4" />,
  get_balance: <Wallet className="h-4 w-4" />,
  // Token / NFT deploys
  deploy_cep18: <Coins className="h-4 w-4" />,
  deploy_cep78: <ImageIcon className="h-4 w-4" />,
  mint_nft: <Layers className="h-4 w-4" />,
  // Token / NFT lookups
  get_token_info: <Coins className="h-4 w-4" />,
  get_token_balance: <Wallet className="h-4 w-4" />,
  get_nft_info: <ImageIcon className="h-4 w-4" />,
  // On-chain agent registry / reputation / compliance
  register_agent: <Network className="h-4 w-4" />,
  attest_agent: <CheckSquare className="h-4 w-4" />,
  get_reputation: <Star className="h-4 w-4" />,
  attest_performance: <Award className="h-4 w-4" />,
  yield_rebalance: <Zap className="h-4 w-4" />,
  compliance_check: <ShieldCheck className="h-4 w-4" />,
  rwa_valuation: <TrendingUp className="h-4 w-4" />,
  fractionalize_rwa: <Layers className="h-4 w-4" />,
  // On-chain lookups
  lookup_deploy: <Search className="h-4 w-4" />,
  lookup_block: <Search className="h-4 w-4" />,
  // Notifications / utilities
  fetch_price: <TrendingUp className="h-4 w-4" />,
  send_email: <Mail className="h-4 w-4" />,
  wallet_readiness: <ShieldCheck className="h-4 w-4" />,
  calculate: <Calculator className="h-4 w-4" />,
  post_message: <MessageSquare className="h-4 w-4" />,
  get_message: <MessageSquare className="h-4 w-4" />,
  // Phase 37 - Casper-unique native capabilities
  update_account_weights: <Sliders className="h-4 w-4" />,
  upgrade_contract_package: <ArrowUpCircle className="h-4 w-4" />,
  update_nft_metadata: <FileText className="h-4 w-4" />,
  add_delegated_key: <Key className="h-4 w-4" />,
  profile_wasm_gas: <Activity className="h-4 w-4" />,
}

const toolColors: Record<string, { border: string; bg: string; text: string }> = {
  transfer: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  batch_transfer: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  get_balance: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  deploy_cep18: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  deploy_cep78: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  mint_nft: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  get_token_info: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  get_token_balance: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  get_nft_info: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  register_agent: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  attest_agent: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  get_reputation: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  attest_performance: { border: "border-foreground/45", bg: "bg-foreground/8", text: "text-foreground" },
  yield_rebalance: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  compliance_check: { border: "border-foreground/35", bg: "bg-foreground/3", text: "text-foreground" },
  rwa_valuation: { border: "border-foreground/45", bg: "bg-foreground/8", text: "text-foreground" },
  fractionalize_rwa: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  lookup_deploy: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  lookup_block: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  fetch_price: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  send_email: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  wallet_readiness: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  calculate: { border: "border-foreground/35", bg: "bg-foreground/3", text: "text-foreground" },
  post_message: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  get_message: { border: "border-foreground/45", bg: "bg-foreground/8", text: "text-foreground" },
  update_account_weights: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  upgrade_contract_package: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
  update_nft_metadata: { border: "border-foreground/40", bg: "bg-foreground/5", text: "text-foreground" },
  add_delegated_key: { border: "border-foreground/50", bg: "bg-foreground/10", text: "text-foreground" },
  profile_wasm_gas: { border: "border-foreground/60", bg: "bg-foreground/15", text: "text-foreground" },
}

export const ToolNode = memo(({ data, type, isConnectable }: NodeProps<NodeData>) => {
  const colors = toolColors[type || ""] || { border: "border-foreground/30", bg: "bg-foreground/5", text: "text-foreground" }
  const icon = toolIcons[type || ""] || null
  const supportMeta = getToolSupportMeta(type)
  const pricing = getToolPrice(type)

  return (
    <div className={`px-4 py-2 shadow-md rounded-md bg-background border-2 ${colors.border} min-w-[150px]`}>
      <div className="flex items-start">
        <div className={`rounded-full w-8 h-8 flex items-center justify-center ${colors.bg} ${colors.text}`}>
          {icon}
        </div>
        <div className="ml-2 flex-1 min-w-0">
          <div className="text-sm font-bold">{data.label || type}</div>
          <div className="text-xs text-muted-foreground">{data.description || "Tool"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${supportMeta.className}`}
            >
              {supportMeta.label}
            </span>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                pricing.tier === "free"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700"
              }`}
              title={pricing.tier === "free" ? "Free to call" : `x402 pricing: ${pricing.priceCspr} CSPR per call`}
            >
              {pricing.tier === "free" ? "Free" : `${pricing.priceCspr} CSPR`}
            </span>
          </div>
        </div>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="w-3 h-3" />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="w-3 h-3" />
    </div>
  )
})

ToolNode.displayName = "ToolNode"

/**
 * Frontend mirror of backend/utils/chains.js TOOL_PRICING. Keep these in
 * sync (or fetch from /v1/tools/pricing on mount — that endpoint is wired
 * to the same backend table).
 *
 * Amounts are in motes (1 CSPR = 1e9 motes) to avoid float drift.
 */

export type ToolTier = "free" | "paid"

export interface ToolPricingEntry {
  tier: ToolTier
  priceMotes: number
  /** Convenience: pre-formatted CSPR string with 2 decimal places. */
  priceCspr: string
}

const TOOL_PRICING: Record<string, ToolPricingEntry> = {
  // Read-only / free
  get_balance: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  get_token_info: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  get_token_balance: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  get_nft_info: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  lookup_deploy: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  lookup_block: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  fetch_price: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  calculate: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  get_reputation: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  wallet_readiness: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  compliance_check: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  get_message: { tier: "free", priceMotes: 0, priceCspr: "0.00" },
  profile_wasm_gas: { tier: "free", priceMotes: 0, priceCspr: "0.00" },

  // Paid
  transfer: { tier: "paid", priceMotes: 100_000_000, priceCspr: "0.10" },
  batch_transfer: { tier: "paid", priceMotes: 250_000_000, priceCspr: "0.25" },
  deploy_cep18: { tier: "paid", priceMotes: 5_000_000_000, priceCspr: "5.00" },
  deploy_cep78: { tier: "paid", priceMotes: 7_500_000_000, priceCspr: "7.50" },
  mint_nft: { tier: "paid", priceMotes: 50_000_000, priceCspr: "0.05" },
  send_email: { tier: "paid", priceMotes: 20_000_000, priceCspr: "0.02" },
  register_agent: { tier: "paid", priceMotes: 500_000_000, priceCspr: "0.50" },
  attest_agent: { tier: "paid", priceMotes: 200_000_000, priceCspr: "0.20" },
  yield_rebalance: { tier: "paid", priceMotes: 100_000_000, priceCspr: "0.10" },
  rwa_valuation: { tier: "paid", priceMotes: 200_000_000, priceCspr: "0.20" },
  fractionalize_rwa: { tier: "paid", priceMotes: 500_000_000, priceCspr: "0.50" },
  attest_performance: { tier: "paid", priceMotes: 200_000_000, priceCspr: "0.20" },
  post_message: { tier: "paid", priceMotes: 100_000_000, priceCspr: "0.10" },
  update_account_weights: { tier: "paid", priceMotes: 500_000_000, priceCspr: "0.50" },
  upgrade_contract_package: { tier: "paid", priceMotes: 5_000_000_000, priceCspr: "5.00" },
  update_nft_metadata: { tier: "paid", priceMotes: 200_000_000, priceCspr: "0.20" },
  add_delegated_key: { tier: "paid", priceMotes: 300_000_000, priceCspr: "0.30" },
}

const FALLBACK: ToolPricingEntry = { tier: "paid", priceMotes: 0, priceCspr: "0.00" }

export function getToolPrice(tool: string | null | undefined): ToolPricingEntry {
  if (!tool) return FALLBACK
  return TOOL_PRICING[tool] ?? FALLBACK
}

export function isFreeTool(tool: string | null | undefined): boolean {
  return getToolPrice(tool).tier === "free"
}

export function listPricedTools(): ToolPricingEntry[] {
  return Object.entries(TOOL_PRICING).map(([tool, entry]) => ({ tool, ...entry }) as any)
}

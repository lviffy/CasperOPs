export type ToolChainSupport = "casper"

export const TOOL_CHAIN_SUPPORT: Record<string, ToolChainSupport> = {
  transfer: "casper",
  deploy_cep18: "casper",
  deploy_cep78: "casper",
  mint_cep78: "casper",
  get_balance: "casper",
  fetch_price: "casper",
  send_email: "casper",
  attest_agent: "casper",
  yield_rebalance: "casper"
}

export function getToolSupportMeta(toolType?: string): {
  label: string
  className: string
} {
  return {
    label: "Casper",
    className: "border-[#FF5A5F] bg-[#FF5A5F]/10 text-[#FF5A5F]",
  }
}

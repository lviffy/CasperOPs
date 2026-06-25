/**
 * Casper Network chain metadata for the BlockOps frontend.
 * BlockOps is Casper-only — Arbitrum and Flow have been removed.
 */

export type SupportedChainId = "casper-test"

export const CHAIN_STORAGE_KEY = "blockops.selectedChain"

export const DEFAULT_CHAIN_ID: SupportedChainId = "casper-test"

export type ChainConfig = {
  id: SupportedChainId
  chainName: string
  name: string
  symbol: string
  decimals: number
  faucetUrl: string
  explorerBaseUrl: string
  rpcUrl: string
  csprCloudUrl: string
}

export const CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  "casper-test": {
    id: "casper-test",
    chainName: "casper-test",
    name: "Casper Network (Testnet)",
    symbol: "CSPR",
    decimals: 9,
    faucetUrl: "https://testnet.cspr.live/tools/faucet",
    explorerBaseUrl: "https://testnet.cspr.live",
    rpcUrl: "https://rpc.testnet.casper.live/rpc",
    csprCloudUrl: "https://api.testnet.cspr.cloud",
  },
}

/**
 * Normalize an inbound chain string. Anything Casper-shaped resolves to
 * `casper-test`; legacy EVM chain ids (flow-testnet, arbitrum-sepolia, 545,
 * 421614, …) are silently mapped to Casper Testnet since BlockOps no longer
 * supports them.
 */
export function normalizeChainId(chain?: string | null): SupportedChainId {
  const normalized = String(chain || "").trim().toLowerCase()
  if (
    normalized === "casper-test" ||
    normalized === "casper" ||
    normalized === "casper-testnet" ||
    normalized === "mainnet" ||
    normalized === "1" ||
    normalized === "2"
  ) {
    return "casper-test"
  }
  return DEFAULT_CHAIN_ID
}

export function getChainConfig(chain?: string | null): ChainConfig {
  return CHAIN_CONFIGS[normalizeChainId(chain)]
}

export function getStoredChain(): SupportedChainId {
  if (typeof window === "undefined") return DEFAULT_CHAIN_ID
  return normalizeChainId(window.localStorage.getItem(CHAIN_STORAGE_KEY))
}

export function setStoredChain(chain: SupportedChainId) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(CHAIN_STORAGE_KEY, chain)
}

export function explorerUrl(accountOrDeploy: string, kind: "account" | "deploy" = "account"): string {
  const base = CHAIN_CONFIGS[DEFAULT_CHAIN_ID].explorerBaseUrl
  return `${base}/${kind}/${accountOrDeploy}`
}

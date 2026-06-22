import { arbitrumSepolia, flowTestnet } from "viem/chains"

export type SupportedChainId = "flow-testnet" | "arbitrum-sepolia"

export const CHAIN_STORAGE_KEY = "blockops.selectedChain"

export const CHAIN_CONFIGS: Record<
  SupportedChainId,
  {
    id: SupportedChainId
    chainId: number
    name: string
    symbol: string
    faucetUrl: string
    explorerBaseUrl: string
    viemChain: typeof flowTestnet | typeof arbitrumSepolia
  }
> = {
  "flow-testnet": {
    id: "flow-testnet",
    chainId: flowTestnet.id,
    name: "Flow EVM Testnet",
    symbol: "FLOW",
    faucetUrl: "https://testnet-faucet.onflow.org/fund-account",
    explorerBaseUrl: "https://evm-testnet.flowscan.io",
    viemChain: flowTestnet,
  },
  "arbitrum-sepolia": {
    id: "arbitrum-sepolia",
    chainId: arbitrumSepolia.id,
    name: "Arbitrum Sepolia",
    symbol: "ETH",
    faucetUrl: "https://www.alchemy.com/faucets/arbitrum-sepolia",
    explorerBaseUrl: "https://sepolia.arbiscan.io",
    viemChain: arbitrumSepolia,
  },
}

export const DEFAULT_CHAIN_ID: SupportedChainId = "flow-testnet"

export function normalizeChainId(chain?: string | null): SupportedChainId {
  const normalized = String(chain || "").trim().toLowerCase()
  if (
    normalized === "flow-testnet" ||
    normalized === "flow" ||
    normalized === "flow-evm" ||
    normalized === "545"
  ) {
    return "flow-testnet"
  }

  if (
    normalized === "arbitrum-sepolia" ||
    normalized === "arbitrum" ||
    normalized === "arb" ||
    normalized === "421614"
  ) {
    return "arbitrum-sepolia"
  }

  return DEFAULT_CHAIN_ID
}

export function getChainConfig(chain?: string | null) {
  return CHAIN_CONFIGS[normalizeChainId(chain)]
}

export function getStoredChain(): SupportedChainId {
  if (typeof window === "undefined") {
    return DEFAULT_CHAIN_ID
  }

  return normalizeChainId(window.localStorage.getItem(CHAIN_STORAGE_KEY))
}

export function setStoredChain(chain: SupportedChainId) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(CHAIN_STORAGE_KEY, chain)
}

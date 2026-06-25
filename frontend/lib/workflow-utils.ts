import type { Node, XYPosition } from "reactflow"
import type { NodeData } from "./types"

let toolIdCounter = 0

export const generateNodeId = (type: string): string => {
  toolIdCounter++
  return `${type}-${toolIdCounter}`
}

export const createNode = ({
  type,
  position,
  id,
}: {
  type: string
  position: XYPosition
  id: string
}): Node<NodeData> => {
  return {
    id,
    type,
    position,
    data: {
      label: getDefaultLabel(type),
      description: getDefaultDescription(type),
      config: {},
    },
  }
}

const getDefaultLabel = (type: string): string => {
  const labels: Record<string, string> = {
    // Native CSPR
    transfer: "CSPR Transfer",
    batch_transfer: "Batch CSPR Transfer",
    get_balance: "Get CSPR Balance",
    
    // Token / NFT Deployment
    deploy_cep18: "Deploy CEP-18 Token",
    deploy_cep78: "Deploy CEP-78 NFT",
    mint_nft: "Mint NFT",
    
    // Token / NFT Lookups
    get_token_info: "CEP-18 Token Info",
    get_token_balance: "CEP-18 Token Balance",
    get_nft_info: "CEP-78 NFT Info",
    
    // On-Chain Lookups
    lookup_deploy: "Lookup Deploy",
    lookup_block: "Lookup Block",
    
    // Notifications & Utilities
    fetch_price: "Fetch CSPR Price",
    send_email: "Send Email",
    wallet_readiness: "Wallet Readiness",
    calculate: "Calculate",
    
    // Agent Workflows
    register_agent: "Register Agent",
    attest_agent: "Attest Agent (RWA)",
    get_reputation: "Get Agent Reputation",
    attest_performance: "Attest Agent Performance",
    yield_rebalance: "Yield Rebalance",
    compliance_check: "Compliance Check",
    rwa_valuation: "RWA Property Valuation",
    fractionalize_rwa: "Fractionalize RWA",
    
    // Messages
    post_message: "Post Message",
    get_message: "Get Message",
    
    // Phase 37 - Casper-unique native capabilities
    update_account_weights: "Update Account Weights",
    upgrade_contract_package: "Upgrade Contract Package",
    update_nft_metadata: "Update NFT Metadata",
    add_delegated_key: "Add Delegated Key",
    profile_wasm_gas: "Profile Wasm Gas",

    // Legacy / EVM / Flow fallbacks
    swap: "Swap",
    deploy_erc20: "Deploy ERC-20",
    deploy_erc721: "Deploy ERC-721",
    create_dao: "Create DAO",
    airdrop: "Airdrop",
    deposit_yield: "Deposit Yield",
    wrap_eth: "Wrap ETH",
    token_metadata: "Token Metadata",
    tx_status: "Transaction Status",
    wallet_history: "Wallet History",
    approve_token: "Approve Token",
    revoke_approval: "Revoke Approval",
  }
  return labels[type] || "Tool"
}

const getDefaultDescription = (type: string): string => {
  const descriptions: Record<string, string> = {
    // Native CSPR
    transfer: "Transfer native CSPR tokens",
    batch_transfer: "Multi-send CSPR to many wallets",
    get_balance: "Fetch wallet CSPR balance",
    
    // Token / NFT Deployment
    deploy_cep18: "Deploy a Casper fungible token",
    deploy_cep78: "Deploy a Casper NFT collection",
    mint_nft: "Mint into a CEP-78 collection",
    
    // Token / NFT Lookups
    get_token_info: "Get token name, symbol, supply",
    get_token_balance: "Get CEP-18 balance for an address",
    get_nft_info: "Get NFT metadata and owner",
    
    // On-Chain Lookups
    lookup_deploy: "Check Casper deploy status",
    lookup_block: "Check Casper block details",
    
    // Notifications & Utilities
    fetch_price: "Live CSPR market price via CSPR.cloud",
    send_email: "Send email notifications",
    wallet_readiness: "Check if a Casper wallet is funded",
    calculate: "Execute basic math operations",
    
    // Agent Workflows
    register_agent: "Register an agent on-chain via AgentFactory",
    attest_agent: "Submit RWA compliance attestation",
    get_reputation: "Read on-chain reputation score",
    attest_performance: "Attest agent success/failure directly to the Reputation contract",
    yield_rebalance: "Rebalance yield vault positions",
    compliance_check: "Check agent/address compliance status",
    rwa_valuation: "Submit/request property valuation or appraisal",
    fractionalize_rwa: "Fractionalize property or asset into RWA shares",
    
    // Messages
    post_message: "Post an encrypted message or log to Casper",
    get_message: "Retrieve and decrypt a message from Casper",
    
    // Phase 37 - Casper-unique native capabilities
    update_account_weights: "Configure multi-sig weights on Casper account",
    upgrade_contract_package: "Upgrade contract package Wasm to a new version",
    update_nft_metadata: "Update metadata for an existing CEP-78 NFT",
    add_delegated_key: "Associate an additional public key with Casper account",
    profile_wasm_gas: "Estimate gas usage for a custom Wasm deploy",

    // Legacy / EVM / Flow fallbacks
    swap: "Swap tokens",
    deploy_erc20: "Deploy ERC-20 token",
    deploy_erc721: "Deploy ERC-721 NFT",
    create_dao: "Create a new DAO",
    airdrop: "Airdrop tokens to addresses",
    deposit_yield: "Deposit to yield farming",
    wrap_eth: "Convert ETH ↔ WETH",
    token_metadata: "Get token info",
    tx_status: "Check tx confirmations",
    wallet_history: "Fetch recent transactions",
    approve_token: "Grant spending approval",
    revoke_approval: "Remove token allowance",
  }
  return descriptions[type] || "Workflow tool"
}

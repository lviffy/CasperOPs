import type { Node, Edge } from 'reactflow'
import { createNode, generateNodeId } from './workflow-utils'

/**
 * Map AI-returned tool types to the in-app Casper-native tool types.
 * Anything not in this map is forwarded as-is and validated against
 * `CASPER_VALID_TOOL_TYPES` below.
 */
const toolTypeMap: Record<string, string> = {
  // CSPR / transfers
  transfer: 'transfer',
  batch_transfer: 'batch_transfer',
  airdrop: 'batch_transfer',
  // Token / NFT deploys
  deploy_cep18: 'deploy_cep18',
  deploy_erc20: 'deploy_cep18',
  deploy_cep78: 'deploy_cep78',
  deploy_erc721: 'deploy_cep78',
  mint_nft: 'mint_nft',
  // On-chain agent registry / reputation / compliance
  register_agent: 'register_agent',
  attest_agent: 'attest_agent',
  get_reputation: 'get_reputation',
  yield_rebalance: 'yield_rebalance',
  // Lookups
  lookup_deploy: 'lookup_deploy',
  tx_status: 'lookup_deploy',
  lookup_block: 'lookup_block',
  get_balance: 'get_balance',
  stt_balance_fetch: 'get_balance',
  fetch_price: 'fetch_price',
  fetch_token_price: 'fetch_price',
  // Notifications / utilities
  send_email: 'send_email',
  wallet_readiness: 'wallet_readiness',
}

/**
 * Casper-native tool types the visual workflow builder accepts.
 * Mirrors the `toolTypes` array in components/workflow-builder.tsx.
 */
const CASPER_VALID_TOOL_TYPES = [
  'transfer',
  'batch_transfer',
  'get_balance',
  'deploy_cep18',
  'deploy_cep78',
  'mint_nft',
  'get_token_info',
  'get_token_balance',
  'get_nft_info',
  'register_agent',
  'attest_agent',
  'get_reputation',
  'yield_rebalance',
  'lookup_deploy',
  'lookup_block',
  'fetch_price',
  'send_email',
  'wallet_readiness',
]

interface AITool {
  id: string
  type: string
  name: string
  next_tools: string[]
}

interface AIResponse {
  agent_id: string
  tools: AITool[]
  has_sequential_execution: boolean
  description: string
  raw_response?: string
}

/**
 * Convert AI response format to ReactFlow nodes and edges.
 */
export function aiResponseToWorkflow(aiResponse: AIResponse): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const toolIdToNodeId = new Map<string, string>()

  aiResponse.tools.forEach((tool, index) => {
    const ourToolType = toolTypeMap[tool.type] || tool.type

    if (!CASPER_VALID_TOOL_TYPES.includes(ourToolType)) {
      console.warn(`Unknown / unsupported tool type from AI: ${tool.type} (mapped to: ${ourToolType})`)
      return
    }

    const nodeId = generateNodeId(ourToolType)
    toolIdToNodeId.set(tool.id, nodeId)

    const row = Math.floor(index / 3)
    const col = index % 3
    const position = {
      x: col * 250 + 100,
      y: row * 150 + 100,
    }

    const node = createNode({
      type: ourToolType,
      position,
      id: nodeId,
    })

    if (tool.name) {
      node.data.label = tool.name
    }

    nodes.push(node)
  })

  aiResponse.tools.forEach((tool) => {
    const sourceNodeId = toolIdToNodeId.get(tool.id)
    if (!sourceNodeId) return

    tool.next_tools.forEach((nextToolId) => {
      const targetNodeId = toolIdToNodeId.get(nextToolId)
      if (targetNodeId) {
        edges.push({
          id: `edge-${sourceNodeId}-${targetNodeId}`,
          source: sourceNodeId,
          target: targetNodeId,
          type: 'custom',
        })
      }
    })
  })

  return { nodes, edges }
}

/**
 * Check if a response is a valid AI workflow response.
 */
export function isValidAIWorkflowResponse(data: any): data is AIResponse {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.tools) &&
    data.tools.length > 0 &&
    data.tools.every(
      (tool: any) =>
        tool &&
        typeof tool.id === 'string' &&
        typeof tool.type === 'string' &&
        Array.isArray(tool.next_tools)
    )
  )
}

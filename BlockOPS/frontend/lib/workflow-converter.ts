import type { Node, Edge } from 'reactflow'
import { generateNodeId, createNode } from './workflow-utils'

/**
 * Convert ReactFlow nodes and edges to the tools format expected by the database
 * Tools are stored IN ORDER. Connected tools form a chain where each tool's next_tool
 * points to the immediate next tool in the series.
 * 
 * @param nodes - Array of workflow nodes
 * @param edges - Array of workflow edges
 * @param agentNodeId - Optional ID of the agent node to filter out
 * @returns Array of tools with next_tool relationships in order
 */
export function workflowToTools(
  nodes: Node[], 
  edges: Edge[], 
  agentNodeId: string = "agent-node"
): Array<{ tool: string; next_tool: string | null }> {
  // Filter out agent node and edges connected to/from agent node
  const toolNodes = nodes.filter((node) => node.id !== agentNodeId && node.type !== "agent")
  const toolEdges = edges.filter((edge) => edge.source !== agentNodeId && edge.target !== agentNodeId)

  // Create a map of node IDs to their tool types
  const nodeIdToType = new Map<string, string>()
  toolNodes.forEach((node) => {
    if (node.type) {
      nodeIdToType.set(node.id, node.type)
    }
  })

  // Create a map of source node ID to target node ID (for edges)
  const nodeToNextNode = new Map<string, string>()
  toolEdges.forEach((edge) => {
    nodeToNextNode.set(edge.source, edge.target)
  })

  // Find all starting nodes (nodes with no incoming edges)
  const nodesWithIncoming = new Set<string>()
  toolEdges.forEach((edge) => {
    nodesWithIncoming.add(edge.target)
  })

  const startingNodes = toolNodes.filter((node) => !nodesWithIncoming.has(node.id))

  // Process each chain starting from nodes with no incoming edges
  const tools: Array<{ tool: string; next_tool: string | null }> = []
  const processedNodeIds = new Set<string>()

  // Helper function to traverse a chain
  const traverseChain = (nodeId: string): void => {
    if (processedNodeIds.has(nodeId)) return

    const nodeType = nodeIdToType.get(nodeId)
    if (!nodeType) return

    processedNodeIds.add(nodeId)

    const nextNodeId = nodeToNextNode.get(nodeId)
    if (nextNodeId) {
      const nextNodeType = nodeIdToType.get(nextNodeId)
      if (nextNodeType) {
        // This tool is connected to the next one
        tools.push({
          tool: nodeType,
          next_tool: nextNodeType,
        })
        // Continue traversing the chain
        traverseChain(nextNodeId)
      } else {
        // Next node exists but has no type
        tools.push({
          tool: nodeType,
          next_tool: null,
        })
      }
    } else {
      // No next node, this is the end of the chain
      tools.push({
        tool: nodeType,
        next_tool: null,
      })
    }
  }

  // Process all chains starting from nodes with no incoming edges
  startingNodes.forEach((node) => {
    traverseChain(node.id)
  })

  // Handle any remaining nodes that weren't processed (isolated nodes without edges)
  toolNodes.forEach((node) => {
    if (!processedNodeIds.has(node.id) && node.type) {
      const nodeType = nodeIdToType.get(node.id)
      if (nodeType) {
        tools.push({
          tool: nodeType,
          next_tool: null,
        })
      }
    }
  })

  return tools
}

/**
 * Convert tools format from database to ReactFlow nodes and edges
 * @param tools - Array of tools with next_tool relationships
 * @param agentNodeId - ID of the agent node to connect starting nodes to
 * @returns Object with nodes and edges arrays
 */
export function toolsToWorkflow(
  tools: Array<{ tool: string; next_tool: string | null }>,
  agentNodeId: string = "agent-node"
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const toolToNodeId = new Map<string, string>()

  // First pass: Create all nodes with unique IDs
  tools.forEach((toolData, index) => {
    const nodeId = generateNodeId(toolData.tool)
    toolToNodeId.set(toolData.tool, nodeId)
    
    // Position nodes in a grid layout (offset to the right of agent node)
    const row = Math.floor(index / 3)
    const col = index % 3
    const position = {
      x: col * 250 + 300, // Offset to the right of agent node
      y: row * 150 + 100,
    }
    
    const node = createNode({
      type: toolData.tool,
      position,
      id: nodeId,
    })
    
    nodes.push(node)
  })

  // Second pass: Create edges based on next_tool relationships
  tools.forEach((toolData) => {
    if (toolData.next_tool) {
      const sourceNodeId = toolToNodeId.get(toolData.tool)
      const targetNodeId = toolToNodeId.get(toolData.next_tool)
      
      if (sourceNodeId && targetNodeId) {
        edges.push({
          id: `edge-${sourceNodeId}-${targetNodeId}`,
          source: sourceNodeId,
          target: targetNodeId,
          type: 'custom',
        })
      }
    }
  })

  // Third pass: Connect all starting nodes to the agent node
  const nodesWithIncoming = new Set<string>()
  edges.forEach((edge) => {
    nodesWithIncoming.add(edge.target)
  })

  nodes.forEach((node) => {
    if (!nodesWithIncoming.has(node.id)) {
      edges.push({
        id: `edge-${agentNodeId}-${node.id}`,
        source: agentNodeId,
        target: node.id,
        type: 'custom',
      })
    }
  })

  return { nodes, edges }
}


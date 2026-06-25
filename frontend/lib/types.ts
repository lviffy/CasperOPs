import type { Node } from "reactflow"

export interface NodeData {
  label: string
  description?: string
  required?: boolean
  config?: Record<string, any> | string
}

export type WorkflowNode = Node<NodeData>

export interface Workflow {
  nodes: WorkflowNode[]
  edges: any[]
}

// Backend Integration Types
export interface AgentChatRequest {
  api_key: string
  user_message: string
  private_key?: string
}

export interface ToolCall {
  tool: string
  parameters: Record<string, any>
}

export interface ToolResult {
  success: boolean
  tool: string
  result: any
  error?: string
}

export interface AgentChatResponse {
  agent_response: string
  tool_calls: ToolCall[]
  results: ToolResult[]
  runtime?: {
    onChainId: string | null
    decision: {
      action: string
      status: string
    }
    verification: {
      allSucceeded: boolean
      verifications: Array<{
        tool: string
        txHash: string
        validationHash: string | null
        success: boolean
        blockNumber?: number
      }>
    }
    agent_log?: any
  }
}

export interface BackendHealthResponse {
  status: string
  service?: string
  blockchain?: string
  ai_model?: string
  backend_url?: string
  network?: string
}

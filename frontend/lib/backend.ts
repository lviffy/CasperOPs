/**
 * Backend Service
 * 
 * This module provides utilities for interacting with the backend services:
 * 1. AI Agent Backend (n8n_agent_backend) - Port 8000 - FastAPI (Legacy - No Memory)
 * 2. Blockchain Backend (backend) - Port 3000 - Express (With Conversation Memory)
 */

import type { 
  AgentChatRequest, 
  AgentChatResponse, 
  BackendHealthResponse 
} from './types'
import type { SupportedChainId } from './chains'

// Backend URLs from environment
const BLOCKCHAIN_API_KEY = process.env.NEXT_PUBLIC_BLOCKCHAIN_API_KEY || ''
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function resolveRuntimeBackendUrl(configuredUrl: string | undefined, fallbackPort: number): string {
  const fallback = `http://localhost:${fallbackPort}`
  const candidate = trimTrailingSlash(configuredUrl || fallback)

  if (typeof window === 'undefined') {
    return candidate
  }

  try {
    const parsed = new URL(candidate)
    const browserHost = window.location.hostname

    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
      parsed.hostname = browserHost
      return trimTrailingSlash(parsed.toString())
    }

    return trimTrailingSlash(parsed.toString())
  } catch {
    return candidate
  }
}

const AI_AGENT_BACKEND_URL = resolveRuntimeBackendUrl(process.env.NEXT_PUBLIC_AI_AGENT_BACKEND_URL, 8000)
const BLOCKCHAIN_BACKEND_URL = resolveRuntimeBackendUrl(process.env.NEXT_PUBLIC_BLOCKCHAIN_BACKEND_URL, 3000)

// ============================================
// CONVERSATION MEMORY API (Port 3000)
// ============================================

export interface ConversationChatRequest {
  agentId: string
  userId: string
  message: string
  chain?: SupportedChainId
  conversationId?: string
  systemPrompt?: string
  walletAddress?: string
  walletType?: 'traditional' | 'pkp'
  pkpPublicKey?: string
  pkpTokenId?: string
  privateKey?: string
  deliveryPlatform?: 'web' | 'telegram'
  telegramChatId?: string
  defaultEmailTo?: string
  userEmail?: string
}

export interface ToolCallInfo {
  tool: string
  parameters: Record<string, any>
}

export interface ToolResultInfo {
  success: boolean
  tool: string
  result: any
  error?: string
}

export interface ToolResults {
  tool_calls: ToolCallInfo[]
  results: ToolResultInfo[]
  routing_plan?: {
    is_off_topic: boolean
    requires_tools: boolean
    complexity: string
    analysis: string
    execution_plan?: {
      type: string
      steps: any[]
    }
  }
}

export interface ConversationChatResponse {
  conversationId: string
  message: string
  isNewConversation: boolean
  messageCount: number
  tokenCount?: number
  toolResults?: ToolResults
  hasTools?: boolean
}

export interface Conversation {
  id: string
  agent_id: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export interface ReminderJob {
  id: string
  agent_id?: string | null
  user_id?: string | null
  conversation_id?: string | null
  delivery_platform?: 'web' | 'telegram' | string
  telegram_chat_id?: string | null
  task_type?: 'balance' | 'portfolio' | 'price' | string
  chain?: SupportedChainId | string | null
  wallet_address?: string | null
  token_query?: string | null
  cron_expression?: string | null
  label?: string | null
  type?: 'one_shot' | 'recurring' | string
  status?: string
  run_count?: number
  last_run_at?: string | null
  last_error?: string | null
  last_result_summary?: string | null
  created_at?: string
  liveStatus?: string
}

export interface ListRemindersResponse {
  success: boolean
  jobs: ReminderJob[]
  total: number
}

export interface CancelReminderResponse {
  success: boolean
  id?: string
  cancelledIds?: string[]
  cancelledCount?: number
  status?: string
  mode?: 'latest' | 'all' | string
  message?: string
}

export interface ScheduledTransferJob {
  id: string
  agent_id?: string | null
  chain?: SupportedChainId | string | null
  wallet_address?: string | null
  to_address?: string | null
  amount?: string | null
  token_address?: string | null
  cron_expression?: string | null
  label?: string | null
  type?: 'one_shot' | 'recurring' | string
  status?: string
  run_count?: number
  last_run_at?: string | null
  last_tx_hash?: string | null
  last_error?: string | null
  created_at?: string
  liveStatus?: string
}

export interface ListScheduledTransfersResponse {
  success: boolean
  jobs: ScheduledTransferJob[]
  total: number
}

export interface CancelScheduledTransferResponse {
  success: boolean
  id?: string
  status?: string
  message?: string
}

/**
 * Send a chat message with conversation memory
 * Uses the Node.js backend (port 3000) with Supabase
 */
export async function sendChatWithMemory(
  request: ConversationChatRequest
): Promise<ConversationChatResponse> {
  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BLOCKCHAIN_API_KEY,
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `Request failed with status ${response.status}`)
  }

  return response.json()
}

/**
 * List user's conversations
 */
export async function listConversations(
  userId: string,
  agentId?: string
): Promise<{ conversations: Conversation[]; count: number }> {
  const params = new URLSearchParams({ userId })
  if (agentId) params.append('agentId', agentId)

  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/api/conversations?${params}`, {
    headers: {
      'x-api-key': BLOCKCHAIN_API_KEY,
    }
  })
  
  if (!response.ok) {
    throw new Error('Failed to list conversations')
  }

  return response.json()
}

/**
 * Get messages for a conversation
 */
export async function getConversationMessages(
  conversationId: string
): Promise<{ messages: ConversationMessage[]; count: number }> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/api/conversations/${conversationId}/messages`,
    {
      headers: {
        'x-api-key': BLOCKCHAIN_API_KEY,
      }
    }
  )
  
  if (!response.ok) {
    throw new Error('Failed to get conversation messages')
  }

  return response.json()
}

/**
 * List reminder jobs for the current user/agent
 */
export async function listRemindersForUser(params: {
  userId: string
  agentId?: string
}): Promise<ListRemindersResponse> {
  const searchParams = new URLSearchParams()
  searchParams.set('userId', params.userId)
  if (params.agentId) {
    searchParams.set('agentId', params.agentId)
  }

  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/reminders?${searchParams.toString()}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to list reminders' }))
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }

  return response.json()
}

/**
 * Cancel reminder job by id
 */
export async function cancelReminderJob(params: {
  id: string
  userId?: string
  agentId?: string
}): Promise<CancelReminderResponse> {
  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/reminders/${params.id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: params.userId,
      agentId: params.agentId,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to cancel reminder' }))
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }

  return response.json()
}

/**
 * List scheduled transfer jobs scoped to the current user/agent
 */
export async function listScheduledTransfersForUser(params: {
  userId: string
  agentId?: string
}): Promise<ListScheduledTransfersResponse> {
  const searchParams = new URLSearchParams()
  searchParams.set('userId', params.userId)
  if (params.agentId) {
    searchParams.set('agentId', params.agentId)
  }

  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/schedule?${searchParams.toString()}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to list scheduled transfers' }))
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }

  return response.json()
}

/**
 * Cancel scheduled transfer job by id
 */
export async function cancelScheduledTransferJob(params: {
  id: string
  userId?: string
  agentId?: string
}): Promise<CancelScheduledTransferResponse> {
  const searchParams = new URLSearchParams()
  if (params.userId) {
    searchParams.set('userId', params.userId)
  }
  if (params.agentId) {
    searchParams.set('agentId', params.agentId)
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/schedule/${params.id}${suffix}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to cancel scheduled transfer' }))
    throw new Error(payload.error || `Request failed with status ${response.status}`)
  }

  return response.json()
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/api/conversations/${conversationId}`,
    {
      method: 'DELETE',
      headers: {
        'x-api-key': BLOCKCHAIN_API_KEY,
      }
    }
  )
  
  if (!response.ok) {
    throw new Error('Failed to delete conversation')
  }
}

// ============================================
// LEGACY AI AGENT API (Port 8000 - No Memory)
// ============================================

/**
 * Send a chat message to the AI agent (Legacy - No Memory)
 * Sends request directly to AI Agent Backend (port 8000)
 * The request format matches TEST_REQUESTS.md from n8n_agent_backend
 */
export async function sendAgentChatMessage(
  tools: Array<{ tool: string; next_tool: string | null }>,
  userMessage: string,
  privateKey?: string
): Promise<AgentChatResponse> {
  const response = await fetch(`${AI_AGENT_BACKEND_URL}/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tools: tools,
      user_message: userMessage,
      private_key: privateKey,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || errorData.detail || `Request failed with status ${response.status}`)
  }

  return response.json()
}



/**
 * Check health of AI Agent Backend
 */
export async function checkAgentBackendHealth(): Promise<BackendHealthResponse> {
  const response = await fetch(`${AI_AGENT_BACKEND_URL}/health`)
  
  if (!response.ok) {
    throw new Error('AI Agent Backend is not responding')
  }

  return response.json()
}

/**
 * Check health of Blockchain Backend
 */
export async function checkBlockchainBackendHealth(): Promise<BackendHealthResponse> {
  const response = await fetch(`${BLOCKCHAIN_BACKEND_URL}/health`)
  
  if (!response.ok) {
    throw new Error('Blockchain Backend is not responding')
  }

  return response.json()
}

/**
 * List all available tools from AI Agent Backend
 */
export async function listAvailableTools(): Promise<{
  tools: string[]
  details: Record<string, any>
}> {
  const response = await fetch(`${AI_AGENT_BACKEND_URL}/tools`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch available tools')
  }

  return response.json()
}

/**
 * Get backend URLs (for debugging)
 */
export function getBackendUrls() {
  return {
    aiAgentBackend: AI_AGENT_BACKEND_URL,
    blockchainBackend: BLOCKCHAIN_BACKEND_URL,
  }
}

// Export backend URLs and API key as constants
export { AI_AGENT_BACKEND_URL, BLOCKCHAIN_BACKEND_URL, BLOCKCHAIN_API_KEY }

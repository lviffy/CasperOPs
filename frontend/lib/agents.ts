import { BLOCKCHAIN_BACKEND_URL, BLOCKCHAIN_API_KEY } from './backend'
import type { Agent } from './supabase'

type ToolConfig = Array<{ tool: string; next_tool: string | null }>

const PLACEHOLDER_API_KEY = 'REPLACE_ME_WITH_A_RANDOM_SECRET'

function getApiKeyHeaders(contentTypeJson = false): Record<string, string> {
  if (!BLOCKCHAIN_API_KEY || BLOCKCHAIN_API_KEY === PLACEHOLDER_API_KEY) {
    throw new Error(
      'Missing NEXT_PUBLIC_BLOCKCHAIN_API_KEY. Set it in frontend/.env to match backend MASTER_API_KEY, then restart the frontend dev server.'
    )
  }

  if (contentTypeJson) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': BLOCKCHAIN_API_KEY,
    }
  }

  return {
    'x-api-key': BLOCKCHAIN_API_KEY,
  }
}

export interface AgentAuditLog {
  id: string
  agent_id: string
  user_id: string
  conversation_id: string | null
  message_excerpt: string | null
  execution_mode: string
  tool_name: string
  tool_index: number | null
  chain: string | null
  params_sanitized: Record<string, unknown>
  result_summary: Record<string, unknown>
  raw_result: unknown
  success: boolean
  tx_hash: string | null
  amount: string | null
  filecoin_cid: string | null
  filecoin_uri: string | null
  filecoin_provider: string | null
  storage_status: string
  storage_error: string | null
  created_at: string
}

export interface ListAgentAuditLogsParams {
  userId: string
  conversationId?: string
  tool?: string
  success?: boolean
  limit?: number
}

export interface AgentAuditLogContent {
  logId: string
  filecoin: {
    status: string
    provider: string
    pieceCid: string | null
    uri: string | null
    contentType?: "json" | "text"
    parseError?: string | null
  }
  envelope: unknown
  payload: unknown
  metadata: unknown
  rawText: string
}

async function parseJson(response: Response) {
  return response.json().catch(() => ({}))
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Unknown network error'
    throw new Error(
      `Failed to reach blockchain backend (${BLOCKCHAIN_BACKEND_URL}). Requested: ${url}. ${detail}`
    )
  }
}

function normalizeAgent(agent: any): Agent {
  return {
    id: agent.id,
    user_id: agent.user_id ?? agent.userId,
    name: agent.name,
    description: agent.description ?? null,
    api_key: agent.api_key ?? agent.apiKey ?? '',
    tools: Array.isArray(agent.tools) ? agent.tools : [],
    on_chain_id: agent.on_chain_id ?? agent.onChainId ?? null,
    created_at: agent.created_at ?? agent.createdAt,
    updated_at: agent.updated_at ?? agent.updatedAt,
  }
}

export async function createAgent(
  userId: string,
  name: string,
  description: string | null,
  tools: ToolConfig
): Promise<Agent> {
  const response = await safeFetch(`${BLOCKCHAIN_BACKEND_URL}/agents`, {
    method: 'POST',
    headers: getApiKeyHeaders(true),
    body: JSON.stringify({
      userId,
      name,
      description,
      tools,
    }),
  })

  const payload = await parseJson(response)
  if (!response.ok || !payload.success) {
    throw new Error(`Failed to create agent: ${payload.error || `Request failed with status ${response.status}`}`)
  }

  return normalizeAgent(payload.agent)
}

export async function getAgentsByUserId(userId: string): Promise<Agent[]> {
  const response = await safeFetch(
    `${BLOCKCHAIN_BACKEND_URL}/agents?userId=${encodeURIComponent(userId)}`,
    {
      headers: getApiKeyHeaders(),
    }
  )
  const payload = await parseJson(response)

  if (!response.ok || !payload.success) {
    throw new Error(`Failed to fetch agents: ${payload.error || `Request failed with status ${response.status}`}`)
  }

  return Array.isArray(payload.agents) ? payload.agents.map(normalizeAgent) : []
}

export async function getAgentById(agentId: string, userId?: string): Promise<Agent | null> {
  const query = new URLSearchParams()
  if (userId) {
    query.set('userId', userId)
  }

  const suffix = query.toString() ? `?${query.toString()}` : ''
  const response = await safeFetch(
    `${BLOCKCHAIN_BACKEND_URL}/agents/${encodeURIComponent(agentId)}${suffix}`,
    {
      headers: getApiKeyHeaders(),
    }
  )
  const payload = await parseJson(response)

  if (response.status === 404) {
    return null
  }

  if (!response.ok || !payload.success) {
    throw new Error(`Failed to fetch agent: ${payload.error || `Request failed with status ${response.status}`}`)
  }

  return normalizeAgent(payload.agent)
}

export async function getAgentByApiKey(apiKey: string): Promise<Agent | null> {
  throw new Error(`Failed to fetch agent: browser-side api_key lookup is not supported`)
}

export async function updateAgent(
  agentId: string,
  updates: {
    name?: string
    description?: string | null
    tools?: ToolConfig
  }
): Promise<Agent> {
  const response = await safeFetch(`${BLOCKCHAIN_BACKEND_URL}/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    headers: getApiKeyHeaders(true),
    body: JSON.stringify(updates),
  })
  const payload = await parseJson(response)

  if (!response.ok || !payload.success) {
    throw new Error(`Failed to update agent: ${payload.error || `Request failed with status ${response.status}`}`)
  }

  return normalizeAgent(payload.agent)
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await safeFetch(`${BLOCKCHAIN_BACKEND_URL}/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    headers: getApiKeyHeaders(),
  })
  const payload = await parseJson(response)

  if (!response.ok || !payload.success) {
    throw new Error(`Failed to delete agent: ${payload.error || `Request failed with status ${response.status}`}`)
  }
}

export async function listAgentAuditLogs(
  agentId: string,
  params: ListAgentAuditLogsParams
): Promise<{ logs: AgentAuditLog[]; count: number }> {
  const query = new URLSearchParams({ userId: params.userId })

  if (params.conversationId) {
    query.set('conversationId', params.conversationId)
  }

  if (params.tool) {
    query.set('tool', params.tool)
  }

  if (typeof params.success === 'boolean') {
    query.set('success', String(params.success))
  }

  if (typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
    query.set('limit', String(Math.floor(params.limit)))
  }

  const response = await safeFetch(
    `${BLOCKCHAIN_BACKEND_URL}/agents/${encodeURIComponent(agentId)}/audit-logs?${query.toString()}`,
    {
      headers: getApiKeyHeaders(),
    }
  )
  const payload = await parseJson(response)

  if (!response.ok || !payload.success) {
    throw new Error(`Failed to fetch audit logs: ${payload.error || `Request failed with status ${response.status}`}`)
  }

  return {
    logs: Array.isArray(payload.logs) ? (payload.logs as AgentAuditLog[]) : [],
    count: typeof payload.count === 'number' ? payload.count : 0,
  }
}

export async function getAgentAuditLogContent(
  agentId: string,
  logId: string,
  userId: string
): Promise<AgentAuditLogContent> {
  const query = new URLSearchParams({ userId })
  const response = await safeFetch(
    `${BLOCKCHAIN_BACKEND_URL}/agents/${encodeURIComponent(agentId)}/audit-logs/${encodeURIComponent(logId)}/content?${query.toString()}`,
    {
      headers: getApiKeyHeaders(),
    }
  )
  const payload = await parseJson(response)

  if (!response.ok || !payload.success) {
    throw new Error(
      `Failed to fetch stored Filecoin JSON: ${payload.error || `Request failed with status ${response.status}`}`
    )
  }

  return payload as AgentAuditLogContent
}

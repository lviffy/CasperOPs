import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return { url, key }
}

let _client: SupabaseClient | null = null

function ensureClient(): SupabaseClient {
  if (_client) return _client
  const { url, key } = readEnv()
  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    )
  }
  _client = createClient(url, key)
  return _client
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = ensureClient()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value
  },
})

/**
 * The only supported wallet type after the Casper migration.
 * The DB CHECK constraint in supabase/migrations/20260622_casper_schema.sql
 * also enforces this on the SQL side.
 */
export type WalletType = 'csprclick'

const USER_FULL_SELECT =
  'id, wallet_address, wallet_type, ed25519_public_key, csprclick_session_id, last_connected_at, created_at, updated_at'

export interface User {
  /** Supabase auth user id (uuid-as-text). */
  id: string
  /** Casper ed25519 public key (hex with 0x/01 prefix) bound via CSPR.click. */
  wallet_address: string | null
  /** Always 'csprclick' for new connections. Null for users who never connected. */
  wallet_type: WalletType | null
  /** Canonical Casper ed25519 public key (mirrors wallet_address; preferred in new code). */
  ed25519_public_key: string | null
  /** CSPR.click session id used to detect session-restore on refresh. */
  csprclick_session_id: string | null
  /** Last time the user connected via CSPR.click. */
  last_connected_at: string | null
  created_at: string
  updated_at: string
}

function normalizeUserRow(row: Partial<User> & { id: string }): User {
  const wallet = row.wallet_address ?? row.ed25519_public_key ?? null
  return {
    id: row.id,
    wallet_address: wallet,
    wallet_type: row.wallet_type ?? null,
    ed25519_public_key: row.ed25519_public_key ?? row.wallet_address ?? null,
    csprclick_session_id: row.csprclick_session_id ?? null,
    last_connected_at: row.last_connected_at ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
  }
}

export function isMissingUsersWalletSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) {
    return false
  }
  return (
    error.code === 'PGRST204' &&
    /wallet_type|ed25519_public_key|csprclick_session_id/i.test(error.message || '')
  )
}

export async function fetchCompatibleUser(userId: string): Promise<{ user: User | null; pkpSchemaReady: boolean }> {
  const fullResponse = await supabase
    .from('users')
    .select(USER_FULL_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    return {
      user: null,
      pkpSchemaReady: false,
    }
  }

  if (fullResponse.error) {
    throw fullResponse.error
  }

  return {
    user: fullResponse.data ? normalizeUserRow(fullResponse.data as User) : null,
    pkpSchemaReady: true,
  }
}

export async function createCompatibleUser(userId: string): Promise<{ user: User; pkpSchemaReady: boolean }> {
  const fullPayload = {
    id: userId,
    wallet_address: null,
    wallet_type: null,
    ed25519_public_key: null,
    csprclick_session_id: null,
    last_connected_at: null,
  }

  const fullResponse = await supabase
    .from('users')
    .insert(fullPayload)
    .select(USER_FULL_SELECT)
    .single()

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    return {
      user: normalizeUserRow({ id: userId }),
      pkpSchemaReady: false,
    }
  }

  if (fullResponse.error) {
    throw fullResponse.error
  }

  return {
    user: normalizeUserRow(fullResponse.data as User),
    pkpSchemaReady: true,
  }
}

export interface WalletUpdate {
  /** Casper ed25519 public key from CSPR.click. Pass `null` to disconnect. */
  wallet_address?: string | null
  /** Always 'csprclick' for new connections. Pass `null` to disconnect. */
  wallet_type?: WalletType | null
  /** Canonical ed25519 public key (mirrors wallet_address). */
  ed25519_public_key?: string | null
  /** CSPR.click session id (set after a successful connect). */
  csprclick_session_id?: string | null
  /** Timestamp of the latest CSPR.click connect. */
  last_connected_at?: string | null
}

export async function updateCompatibleUserWallet(
  userId: string,
  updates: WalletUpdate,
): Promise<{ pkpSchemaReady: boolean }> {
  const fullResponse = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    return { pkpSchemaReady: false }
  }

  if (fullResponse.error) {
    throw fullResponse.error
  }

  return { pkpSchemaReady: true }
}

export interface Agent {
  id: string
  user_id: string
  name: string
  description: string | null
  api_key: string
  tools: Array<{
    tool: string
    next_tool: string | null
  }>
  on_chain_id?: string | null
  created_at: string
  updated_at: string
}

// =============================================================================
// New tables (deploy_history, tool_executions, reputation_events)
// =============================================================================

export type DeployStatus = 'pending' | 'executed' | 'finalized' | 'failed'

export interface DeployHistoryRow {
  id: string
  user_id: string
  tool_id: string | null
  contract_hash: string | null
  entry_point: string | null
  deploy_hash: string
  status: DeployStatus
  error_message: string | null
  cost_motes: string | null
  created_at: string
  finalized_at: string | null
}

export interface ToolExecutionRow {
  id: string
  user_id: string | null
  workflow_id: string | null
  tool_id: string
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  x402_payment_hash: string | null
  price_motes: string | null
  created_at: string
}

export async function recordDeploy(
  userId: string,
  fields: {
    tool_id?: string
    contract_hash?: string
    entry_point?: string
    deploy_hash: string
    status?: DeployStatus
  },
): Promise<DeployHistoryRow | null> {
  const { data, error } = await supabase
    .from('deploy_history')
    .insert({
      user_id: userId,
      tool_id: fields.tool_id ?? null,
      contract_hash: fields.contract_hash ?? null,
      entry_point: fields.entry_point ?? null,
      deploy_hash: fields.deploy_hash,
      status: fields.status ?? 'pending',
    })
    .select('*')
    .single()
  if (error) {
    console.warn('[supabase] recordDeploy failed:', error)
    return null
  }
  return data as DeployHistoryRow
}

export async function updateDeployStatus(
  deployHash: string,
  status: DeployStatus,
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabase
    .from('deploy_history')
    .update({
      status,
      error_message: errorMessage ?? null,
      finalized_at: status === 'finalized' || status === 'failed' ? new Date().toISOString() : null,
    })
    .eq('deploy_hash', deployHash)
  if (error) console.warn('[supabase] updateDeployStatus failed:', error)
}

export async function recordToolExecution(
  userId: string | null,
  fields: {
    workflow_id?: string
    tool_id: string
    params: Record<string, unknown>
    result?: Record<string, unknown> | null
    x402_payment_hash?: string | null
    price_motes?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('tool_executions').insert({
    user_id: userId,
    workflow_id: fields.workflow_id ?? null,
    tool_id: fields.tool_id,
    params: fields.params,
    result: fields.result ?? null,
    x402_payment_hash: fields.x402_payment_hash ?? null,
    price_motes: fields.price_motes ?? null,
  })
  if (error) console.warn('[supabase] recordToolExecution failed:', error)
}

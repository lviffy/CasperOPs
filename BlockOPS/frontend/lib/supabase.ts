import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey
  })
  throw new Error('Missing Supabase environment variables')
}

console.log('Supabase initialized with URL:', supabaseUrl)

export const supabase = createClient(supabaseUrl, supabaseKey)

export type WalletType = 'traditional' | 'pkp'
const USER_FULL_SELECT = 'id, private_key, wallet_address, wallet_type, pkp_public_key, pkp_token_id, created_at, updated_at'
const USER_LEGACY_SELECT = 'id, private_key, wallet_address, created_at, updated_at'

export interface User {
  id: string // Privy DID (format: did:privy:xxxxx)
  private_key: string | null // Lit ciphertext payload or legacy plaintext key
  wallet_address: string | null
  wallet_type: WalletType | null
  pkp_public_key: string | null
  pkp_token_id: string | null
  created_at: string
  updated_at: string
}

function normalizeUserRow(row: Partial<User> & { id: string }): User {
  return {
    id: row.id,
    private_key: row.private_key ?? null,
    wallet_address: row.wallet_address ?? null,
    wallet_type: row.wallet_type ?? null,
    pkp_public_key: row.pkp_public_key ?? null,
    pkp_token_id: row.pkp_token_id ?? null,
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
    /wallet_type|pkp_public_key|pkp_token_id/i.test(error.message || '')
  )
}

export async function fetchCompatibleUser(userId: string): Promise<{ user: User | null; pkpSchemaReady: boolean }> {
  const fullResponse = await supabase
    .from('users')
    .select(USER_FULL_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    const legacyResponse = await supabase
      .from('users')
      .select(USER_LEGACY_SELECT)
      .eq('id', userId)
      .maybeSingle()

    if (legacyResponse.error) {
      throw legacyResponse.error
    }

    return {
      user: legacyResponse.data ? normalizeUserRow(legacyResponse.data as User) : null,
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
    private_key: null,
    wallet_address: null,
    wallet_type: null,
    pkp_public_key: null,
    pkp_token_id: null,
  }

  const fullResponse = await supabase
    .from('users')
    .insert(fullPayload)
    .select(USER_FULL_SELECT)
    .single()

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    const legacyResponse = await supabase
      .from('users')
      .insert({
        id: userId,
        private_key: null,
        wallet_address: null,
      })
      .select(USER_LEGACY_SELECT)
      .single()

    if (legacyResponse.error) {
      throw legacyResponse.error
    }

    return {
      user: normalizeUserRow(legacyResponse.data as User),
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

export async function updateCompatibleUserWallet(
  userId: string,
  updates: Partial<Pick<User, 'private_key' | 'wallet_address' | 'wallet_type' | 'pkp_public_key' | 'pkp_token_id'>>
): Promise<{ pkpSchemaReady: boolean }> {
  const fullResponse = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)

  if (isMissingUsersWalletSchemaError(fullResponse.error)) {
    const isPkpWrite =
      updates.wallet_type === 'pkp' ||
      typeof updates.pkp_public_key === 'string' ||
      typeof updates.pkp_token_id === 'string'

    if (isPkpWrite) {
      throw new Error(
        'Your Supabase users table is missing the PKP columns. Run frontend/MIGRATION_FIX.sql in Supabase, then reload the app.'
      )
    }

    const legacyResponse = await supabase
      .from('users')
      .update({
        private_key: updates.private_key ?? null,
        wallet_address: updates.wallet_address ?? null,
      })
      .eq('id', userId)

    if (legacyResponse.error) {
      throw legacyResponse.error
    }

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

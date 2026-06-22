import type { User, WalletType } from './supabase'
import { hasStoredSigningKey } from './lit-private-key'
import type { SupportedChainId } from './chains'

export interface PkpWalletResult {
  walletType: 'pkp'
  walletAddress: string
  pkpPublicKey: string
  pkpTokenId: string
  mintedAt: string
}

export interface PkpTransactionRequest {
  to: string
  data?: string | null
  value?: string | null
  gas?: string | null
  maxFeePerGas?: string | null
  maxPriorityFeePerGas?: string | null
  nonce?: number | null
}

export interface PkpTransactionResult {
  hash: string
  explorerUrl: string
  blockNumber: number
  gasUsed: string
  status: 'success' | 'failed'
}

export type WalletRecordLike = Pick<
  User,
  'private_key' | 'wallet_address' | 'wallet_type' | 'pkp_public_key' | 'pkp_token_id'
>

export type StoredPkpWalletRecord = WalletRecordLike & {
  wallet_type: 'pkp'
  wallet_address: string
  pkp_public_key: string
  pkp_token_id: string
}

export function isTraditionalWallet(walletType: WalletType | null | undefined): walletType is 'traditional' {
  return walletType === 'traditional'
}

export function isPkpWallet(walletType: WalletType | null | undefined): walletType is 'pkp' {
  return walletType === 'pkp'
}

export function hasStoredPkpWallet(
  user: WalletRecordLike | null | undefined
): user is StoredPkpWalletRecord {
  return Boolean(
    user &&
      isPkpWallet(user.wallet_type) &&
      user.wallet_address &&
      user.pkp_public_key &&
      user.pkp_token_id
  )
}

export function hasConfiguredAgentWallet(user: WalletRecordLike | null | undefined): boolean {
  if (!user) {
    return false
  }

  return hasStoredSigningKey(user.private_key) || hasStoredPkpWallet(user)
}

export async function mintPkpWallet(): Promise<PkpWalletResult> {
  const response = await fetch('/api/lit/pkp/mint', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to mint PKP wallet' }))
    throw new Error(errorData.error || 'Failed to mint PKP wallet')
  }

  return response.json()
}

export async function signTransactionWithPkp(params: {
  pkpPublicKey: string
  pkpTokenId?: string | null
  chain?: SupportedChainId
  transaction: PkpTransactionRequest
}): Promise<PkpTransactionResult> {
  const response = await fetch('/api/lit/pkp/sign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to sign transaction with PKP' }))
    throw new Error(errorData.error || 'Failed to sign transaction with PKP')
  }

  return response.json()
}

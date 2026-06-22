import { ethers } from 'ethers'
import { updateCompatibleUserWallet } from './supabase'
import { encryptPrivateKeyForStorage, normalizePrivateKey } from './lit-private-key'
import { getChainConfig, type SupportedChainId } from './chains'

/**
 * Create a new EVM wallet
 * @returns Object with address and private key
 */
export function createWallet(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom()
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  }
}

/**
 * Get wallet address from private key
 * @param privateKey - The private key to derive address from
 * @returns The wallet address
 */
export function getAddressFromPrivateKey(privateKey: string): string {
  try {
    const wallet = new ethers.Wallet(privateKey)
    return wallet.address
  } catch (error) {
    throw new Error('Invalid private key')
  }
}

/**
 * Validate private key format
 * @param privateKey - The private key to validate
 * @returns True if valid
 */
export function isValidPrivateKey(privateKey: string): boolean {
  try {
    // Remove 0x prefix if present
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
    
    // Check if it's a valid hex string and correct length (64 hex chars = 32 bytes)
    if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      return false
    }
    
    // Try to create a wallet from it
    const wallet = new ethers.Wallet(`0x${cleanKey}`)
    return !!wallet.address
  } catch {
    return false
  }
}

/**
 * Save wallet to user's Supabase record
 * @param userId - The user ID
 * @param walletAddress - The wallet address
 * @param privateKey - The private key
 */
export async function saveWalletToUser(
  userId: string,
  walletAddress: string,
  privateKey: string
): Promise<void> {
  const normalizedPrivateKey = normalizePrivateKey(privateKey)
  const litEncryptedPayload = await encryptPrivateKeyForStorage(normalizedPrivateKey)

  await updateCompatibleUserWallet(userId, {
    wallet_address: walletAddress,
    private_key: litEncryptedPayload,
    wallet_type: 'traditional',
    pkp_public_key: null,
    pkp_token_id: null,
  })
}

/**
 * Remove wallet from user's Supabase record
 * @param userId - The user ID
 */
export async function removeWalletFromUser(userId: string): Promise<void> {
  await updateCompatibleUserWallet(userId, {
    wallet_address: null,
    private_key: null,
    wallet_type: null,
    pkp_public_key: null,
    pkp_token_id: null,
  })
}

/**
 * Fetch native balance on the selected chain
 * @param address - The wallet address
 * @returns Native balance as string
 */
export async function getTokenBalances(address: string): Promise<{
  native: string
  symbol: string
}> {
  return getTokenBalancesForChain(address, 'flow-testnet')
}

export async function getTokenBalancesForChain(
  address: string,
  chain: SupportedChainId
): Promise<{
  native: string
  symbol: string
}> {
  const chainConfig = getChainConfig(chain)
  const rpcUrl =
    chainConfig.viemChain.rpcUrls.default.http[0] ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://testnet.evm.nodes.onflow.org'

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const balance = await provider.getBalance(address)

    const formattedBalance = ethers.formatEther(balance)
    const numericBalance = parseFloat(formattedBalance)
    const nativeBalance = numericBalance.toFixed(2)

    return {
      native: nativeBalance,
      symbol: chainConfig.symbol,
    }
  } catch (error) {
    console.error(`Error fetching ${chainConfig.symbol} balance:`, error)
    return {
      native: '0.00',
      symbol: chainConfig.symbol,
    }
  }
}

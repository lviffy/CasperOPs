/**
 * BlockOps CSPR.click authentication hook.
 *
 * Replaces the legacy `@privy-io/react-auth` `usePrivy` hook. Exposes a
 * stable `useAuth()` API so every page that previously consumed Privy
 * keeps working without modification.
 *
 * The hook manages three pieces of state:
 *   1. **CSPR.click account** (browser wallet)
 *   2. **Supabase user row** (csprclick_public_key, ed25519_public_key, …)
 *   3. **Loading / error flags**
 *
 * The wallet stays in the user's browser — only the public key is stored
 * in Supabase.
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  initCsprClick,
  connectWallet,
  disconnectWallet,
  getActiveAccount,
  saveWalletToUser,
  removeWalletFromUser,
  type ConnectedAccount,
} from './wallet'
import {
  createCompatibleUser,
  fetchCompatibleUser,
  type User,
} from './supabase'

export interface CsprAuthUser {
  /** Supabase auth user id (uuid-as-text). */
  id: string
  /** Casper ed25519 public key (hex with 0x/01/02 prefix). */
  publicKey: string
  /** Provider id (e.g. "casper-wallet", "casper-signer", "ledger"). */
  provider: string
  /** Optional CSPR name (e.g. "alice.cspr"). */
  csprName?: string | null
  /** Optional CSPR balance in CSPR (decimal). */
  balance?: string | null
}

/**
 * BlockOps auth hook. Connects a CSPR.click wallet, persists the public key
 * to Supabase, and exposes the active session for the React tree.
 *
 * @returns An object with `ready`, `authenticated`, `user`, `csprclickPublicKey`,
 *   `privyWalletAddress` (legacy alias), `dbUser`, `isWalletLogin`, and helpers
 *   for connecting / disconnecting / syncing.
 */
export function useAuth() {
  const [ready, setReady] = useState(false)
  const [account, setAccount] = useState<ConnectedAccount | null>(null)
  const [dbUser, setDbUser] = useState<User | null>(null)
  const [hydrating, setHydrating] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [schemaReady, setSchemaReady] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sdk = initCsprClick()
    setReady(true)
    if (!sdk) {
      setHydrating(false)
      return
    }

    const getActiveAccountPromise = sdk.getActiveAccountAsync({ withBalance: false })
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CSPR.click active account fetch timed out')), 1500)
    )

    Promise.race([getActiveAccountPromise, timeoutPromise])
      .then((active: any) => {
        if (active?.public_key) {
          setAccount({
            publicKey: active.public_key,
            provider: active.provider || 'casper-wallet',
            csprName: active.cspr_name ?? null,
            balance: active.liquid_balance ?? null,
            balanceMotes: active.liquid_balance ?? null,
          })
        }
      })
      .catch((err) => {
        console.warn('[auth] session check failed or timed out:', err)
        // No active session or timeout — caller will prompt connect.
      })
      .finally(() => setHydrating(false))

    const handleSignedIn = (evt: any) => {
      console.log('[auth] Event: csprclick:signed_in received:', evt)
      if (evt?.account) {
        const newAccount = {
          publicKey: evt.account.public_key,
          provider: evt.account.provider || 'casper-wallet',
          csprName: evt.account.cspr_name ?? null,
          balance: evt.account.liquid_balance ?? null,
          balanceMotes: evt.account.liquid_balance ?? null,
        }
        setAccount(newAccount)
        console.log('[auth] Event: saving wallet to user...', newAccount.publicKey)
        saveWalletToUser(newAccount.publicKey, newAccount.publicKey)
          .then(() => console.log('[auth] Event: wallet saved successfully'))
          .catch((err) => console.warn('[auth] Event: saveWalletToUser failed:', err))
      }
    }

    const handleSwitchedAccount = (evt: any) => {
      console.log('[auth] Event: csprclick:switched_account received:', evt)
      if (evt?.account) {
        const newAccount = {
          publicKey: evt.account.public_key,
          provider: evt.account.provider || 'casper-wallet',
          csprName: evt.account.cspr_name ?? null,
          balance: evt.account.liquid_balance ?? null,
          balanceMotes: evt.account.liquid_balance ?? null,
        }
        setAccount(newAccount)
        console.log('[auth] Event: saving switched wallet to user...', newAccount.publicKey)
        saveWalletToUser(newAccount.publicKey, newAccount.publicKey)
          .then(() => console.log('[auth] Event: switched wallet saved successfully'))
          .catch((err) => console.warn('[auth] Event: saveWalletToUser failed:', err))
      }
    }

    const handleSignedOut = () => {
      console.log('[auth] Event: csprclick:signed_out')
      setAccount(null)
    }

    const handleDisconnected = () => {
      console.log('[auth] Event: csprclick:disconnected')
      setAccount(null)
    }

    if (typeof sdk.on === 'function') {
      sdk.on('csprclick:signed_in', handleSignedIn)
      sdk.on('csprclick:switched_account', handleSwitchedAccount)
      sdk.on('csprclick:unsolicited_account_change', handleSwitchedAccount)
      sdk.on('csprclick:signed_out', handleSignedOut)
      sdk.on('csprclick:disconnected', handleDisconnected)
    }

    return () => {
      if (typeof sdk.off === 'function') {
        sdk.off('csprclick:signed_in', handleSignedIn)
        sdk.off('csprclick:switched_account', handleSwitchedAccount)
        sdk.off('csprclick:unsolicited_account_change', handleSwitchedAccount)
        sdk.off('csprclick:signed_out', handleSignedOut)
        sdk.off('csprclick:disconnected', handleDisconnected)
      }
    }
  }, [])

  const syncUser = useCallback(async () => {
    const pk = account?.publicKey
    console.log('[auth] syncUser starting. pk:', pk)
    if (!pk) return
    setSyncing(true)
    try {
      const { user: existing, pkpSchemaReady } = await fetchCompatibleUser(pk)
      console.log('[auth] fetchCompatibleUser result existing:', existing, 'pkpSchemaReady:', pkpSchemaReady)
      setSchemaReady(pkpSchemaReady)

      if (existing) {
        setDbUser(existing)
      } else {
        const created = await createCompatibleUser(pk)
        console.log('[auth] createCompatibleUser result created:', created)
        setSchemaReady(created.pkpSchemaReady)
        setDbUser(created.user)
      }
    } catch (error) {
      console.error('[auth] sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }, [account?.publicKey])

  useEffect(() => {
    if (!ready || hydrating) return
    if (account?.publicKey) {
      syncUser()
    } else {
      setDbUser(null)
    }
  }, [ready, hydrating, account?.publicKey, syncUser])

  const login = useCallback(
    async (provider: string = 'casper-wallet') => {
      console.log('[auth] login() called. provider:', provider)
      const connected = await connectWallet(provider)
      console.log('[auth] login() connectWallet result:', connected)
      if (!connected) return null
      setAccount(connected)
      try {
        console.log('[auth] saving wallet to user...')
        await saveWalletToUser(connected.publicKey, connected.publicKey)
        console.log('[auth] wallet saved successfully')
      } catch (err) {
        console.warn('[auth] saveWalletToUser failed:', err)
      }
      return connected
    },
    [],
  )

  const logout = useCallback(
    async (provider: string = 'casper-wallet') => {
      try {
        await disconnectWallet(provider)
      } catch (err) {
        console.warn('[auth] disconnect failed:', err)
      }
      const pk = account?.publicKey
      if (pk) {
        try {
          await removeWalletFromUser(pk)
        } catch (err) {
          console.warn('[auth] removeWalletFromUser failed:', err)
        }
      }
      setAccount(null)
      setDbUser(null)
    },
    [account?.publicKey],
  )

  const user = useMemo<CsprAuthUser | null>(() => {
    if (!account) return null
    return {
      id: account.publicKey,
      publicKey: account.publicKey,
      provider: account.provider,
      csprName: account.csprName ?? null,
      balance: account.balance ?? null,
    }
  }, [account])

  return {
    ready,
    authenticated: !!account,
    loading: hydrating || syncing,
    user,
    dbUser,

    csprclickPublicKey: account?.publicKey ?? null,
    privyWalletAddress: account?.publicKey ?? null,
    isWalletLogin: !!account,

    login,
    logout,
    syncUser,

    showPrivateKeySetup: false,
    setShowPrivateKeySetup: () => {},
    pkpSchemaReady: schemaReady,
    schemaReady,
  }
}

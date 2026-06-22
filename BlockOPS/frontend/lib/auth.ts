'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useEffect, useState } from 'react'
import { createCompatibleUser, fetchCompatibleUser, type User } from './supabase'
import { hasConfiguredAgentWallet } from './lit-pkp'

export function useAuth() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const [dbUser, setDbUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPrivateKeySetup, setShowPrivateKeySetup] = useState(false)
  const [hasCheckedPrivateKey, setHasCheckedPrivateKey] = useState(false)
  const [pkpSchemaReady, setPkpSchemaReady] = useState(true)

  // Check if user logged in via wallet
  const isWalletLogin = authenticated && wallets && wallets.length > 0
  
  // Get the primary wallet address if available
  const privyWalletAddress = wallets && wallets.length > 0 ? wallets[0].address : null

  useEffect(() => {
    if (ready && authenticated && user) {
      syncUser()
    } else {
      setDbUser(null)
      setLoading(false)
      // Reset the check when user logs out
      setHasCheckedPrivateKey(false)
      setPkpSchemaReady(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user])

  const syncUser = async () => {
    if (!user?.id) {
      console.warn('Cannot sync user: No user ID available')
      return
    }

    setLoading(true)
    try {
      const { user: existingUser, pkpSchemaReady: schemaReady } = await fetchCompatibleUser(user.id)
      setPkpSchemaReady(schemaReady)

      if (existingUser) {
        setDbUser(existingUser)
        
        // Check if user needs to set up private key (only once per session)
        if (!hasConfiguredAgentWallet(existingUser) && !hasCheckedPrivateKey) {
          setShowPrivateKeySetup(true)
          setHasCheckedPrivateKey(true)
        }
      } else {
        // User doesn't exist, create new user
        const createdUserResponse = await createCompatibleUser(user.id)
        setPkpSchemaReady(createdUserResponse.pkpSchemaReady)
        setDbUser(createdUserResponse.user)

        // Show private key setup modal for new users
        setShowPrivateKeySetup(true)
        setHasCheckedPrivateKey(true)
      }
    } catch (error) {
      console.error('Error syncing user:', error)
    } finally {
      setLoading(false)
    }
  }

  const connectMetaMask = async () => {
    // Use Privy's login modal directly
    try {
      await login()
    } catch (error) {
      console.error('Login error:', error)
    }
  }

  return {
    ready,
    authenticated,
    user,
    dbUser,
    loading,
    login: connectMetaMask,
    logout,
    syncUser,
    isWalletLogin,
    privyWalletAddress,
    showPrivateKeySetup,
    setShowPrivateKeySetup,
    pkpSchemaReady,
  }
}

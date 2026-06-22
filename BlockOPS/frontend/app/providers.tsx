'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { Toaster } from '@/components/ui/toaster'
import { useEffect, useState } from 'react'
import { arbitrumSepolia, flowTestnet } from 'viem/chains'

export function Providers({ children }: { children: React.ReactNode }) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!privyAppId) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is not set')
  }


  // Don't render children until PrivyProvider is available on client side
  // This prevents Privy hooks (useWallets, usePrivy) from being called outside PrivyProvider
  if (!mounted) {
    return null
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['email', 'wallet', 'google', 'github'],
        supportedChains: [flowTestnet, arbitrumSepolia],
        defaultChain: flowTestnet,
        appearance: {
          theme: 'dark',
          accentColor: '#1a1a1a',
          logo: undefined,
        },
      }}
    >
      {children}
      <Toaster />
    </PrivyProvider>
  )
}

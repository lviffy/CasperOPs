'use client'

import { Toaster } from '@/components/ui/toaster'
import { useEffect, useState } from 'react'
import { initCsprClick } from '@/lib/wallet'

/**
 * Root providers for the BlockOps app.
 *
 * BlockOps now uses CSPR.click for wallet session management, so the provider
 * tree only needs to:
 *   1. Eagerly initialise the CSPR.click SDK on the client (so the first hook
 *      that calls `initCsprClick()` doesn't pay the cost of bootstrapping
 *      iframe message listeners).
 *   2. Mount the UI toaster.
 *
 * No EVM wagmi/RainbowKit/Privy provider is needed.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    initCsprClick()
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <>
      {children}
      <Toaster />
    </>
  )
}

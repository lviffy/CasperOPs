// Polyfill for localStorage in server-side environment
if (typeof window === 'undefined') {
  // Server-side mock implementation
  const store: Record<string, string> = {}

  global.localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key])
    },
    key: (index: number) => Object.keys(store)[index] || null,
    get length() {
      return Object.keys(store).length
    }
  } as Storage
}

if (typeof window !== 'undefined') {
  const originalError = console.error
  console.error = (...args: any[]) => {
    const errorStr = args
      .map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')

    // Filter out harmless Casper/CSPR.click locked wallet/key support console errors
    if (
      errorStr.includes('Cant fetch getActivePublicKeySupports list') ||
      errorStr.includes('Wallet is locked') ||
      errorStr.includes('_getActivePublicKeySupports')
    ) {
      console.warn('[CSPR.click Filtered Error]:', ...args)
      return
    }

    originalError(...args)
  }
}

export {}

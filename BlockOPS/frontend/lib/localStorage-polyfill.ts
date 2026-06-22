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

export {}

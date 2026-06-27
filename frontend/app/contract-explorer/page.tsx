"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, User, Wallet, LogOut, Edit3, Plus, Trash2, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react"
import { ContractInteraction } from "@/components/contract-interaction"
import { useAuth } from "@/lib/auth"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ─── CEP-78 Metadata Updater Panel ───────────────────────────────────────────

function Cep78MetadataPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [collectionHash, setCollectionHash] = useState('')
  const [tokenId, setTokenId] = useState('')
  const [metaEntries, setMetaEntries] = useState([{ key: '', value: '' }])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const addEntry = () => setMetaEntries(prev => [...prev, { key: '', value: '' }])
  const removeEntry = (i: number) => setMetaEntries(prev => prev.filter((_, idx) => idx !== i))
  const updateEntry = (i: number, field: 'key' | 'value', val: string) =>
    setMetaEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e))

  const submit = async () => {
    const metadata = Object.fromEntries(metaEntries.filter(e => e.key).map(e => [e.key, e.value]))
    if (!collectionHash || !tokenId || Object.keys(metadata).length === 0) {
      setError('Collection hash, token ID, and at least one metadata entry are required')
      return
    }
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await fetch('/api/nft/update-metadata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_hash: collectionHash.trim(), token_id: tokenId, metadata }),
      })
      const data = await r.json()
      if (data.ok) setResult(data)
      else setError(data.error || 'Failed')
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="mt-8">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-dashed border-violet-500/30 text-sm text-violet-400 hover:bg-violet-500/5 hover:border-violet-500/50 transition-all"
      >
        <Edit3 size={14} />
        <span className="font-medium">CEP-78 Metadata Updater</span>
        <span className="ml-auto text-xs text-gray-500">Casper-native mutable NFT metadata</span>
      </button>

      {isOpen && (
        <div className="mt-3 p-5 rounded-2xl bg-white/[0.03] border border-white/8 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">CEP-78 Collection Hash</label>
              <input value={collectionHash} onChange={e => setCollectionHash(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/60 font-mono"
                placeholder="hash-abc123..." />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Token ID</label>
              <input value={tokenId} onChange={e => setTokenId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
                placeholder="0" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-400">Metadata Fields</label>
              <button onClick={addEntry} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                <Plus size={11} /> Add field
              </button>
            </div>
            {metaEntries.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <input value={entry.key} onChange={e => updateEntry(i, 'key', e.target.value)}
                  className="w-2/5 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
                  placeholder="property" />
                <input value={entry.value} onChange={e => updateEntry(i, 'value', e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
                  placeholder="value" />
                {metaEntries.length > 1 && (
                  <button onClick={() => removeEntry(i)} className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button onClick={submit} disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Edit3 size={13} />}
            Prepare Metadata Update
          </button>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
          {result && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                <CheckCircle2 size={14} /> Deploy prepared — sign with CSPR.click
              </div>
              <p className="text-xs text-gray-400">{result.message}</p>
              {result.explorerUrl && (
                <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                  View collection <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContractExplorerPage() {
  const router = useRouter()
  const { logout, dbUser, privyWalletAddress, isWalletLogin, authenticated } = useAuth()

  const walletAddress = dbUser?.wallet_address || (isWalletLogin ? privyWalletAddress : null)
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Not connected'

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 lg:py-14">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => router.push("/my-agents")}
                  aria-label="Back to my agents"
                  className="text-muted-foreground hover:text-foreground transition-colors -ml-1"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <h1 className="text-3xl font-serif font-normal tracking-tight">
                  Contract Explorer
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Interact with smart contracts on the blockchain
              </p>
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Open user menu"
                  className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Avatar className="size-9 cursor-pointer">
                    <AvatarFallback className="bg-muted">
                      <User className="size-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-xs text-muted-foreground">Wallet</p>
                    <p className="text-xs font-mono leading-none">
                      {truncatedAddress}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Wallet className="mr-2 size-4" />
                  {authenticated && walletAddress ? 'Connected' : 'Not Connected'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                  <LogOut className="mr-2 size-4" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Separator className="mt-6" />
        </header>

        {/* Main Content */}
        <ContractInteraction />

        {/* Phase 37: CEP-78 Metadata Updater */}
        <Cep78MetadataPanel />
      </div>
    </div>
  )
}

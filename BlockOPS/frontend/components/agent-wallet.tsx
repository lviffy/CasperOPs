"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Wallet,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Loader2,
  ChevronDown,
  CircleAlert,
  Fuel,
} from "lucide-react"
import { useAuth } from "@/lib/auth"
import {
  initCsprClick,
  connectWallet,
  disconnectWallet,
  getActiveAccount,
  getKnownAccounts,
  switchAccount,
  saveWalletToUser,
  removeWalletFromUser,
  fetchCsprBalance,
  casperExplorerUrl,
  type ConnectedAccount,
} from "@/lib/wallet"
import { CHAIN_CONFIGS, getStoredChain } from "@/lib/chains"
import { mapCsprClickError } from "@/lib/csprclick-errors"
import { toast } from "@/components/ui/use-toast"

interface AgentWalletModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hideButton?: boolean
}

const ACTIVE_PROVIDER = "casper-wallet"

export function AgentWalletModal({ open, onOpenChange, hideButton = false }: AgentWalletModalProps) {
  const { user, dbUser, syncUser, loading } = useAuth()
  const [account, setAccount] = useState<ConnectedAccount | null>(null)
  const [knownAccounts, setKnownAccounts] = useState<ConnectedAccount[]>([])
  const [balance, setBalance] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [sdkReady, setSdkReady] = useState(false)

  const chainConfig = CHAIN_CONFIGS[getStoredChain()]

  const refreshBalance = useCallback(async (publicKey?: string | null) => {
    const pk = publicKey || account?.publicKey || dbUser?.wallet_address
    if (!pk) {
      setBalance(null)
      return
    }
    const bal = await fetchCsprBalance(pk)
    setBalance(bal)
  }, [account?.publicKey, dbUser?.wallet_address])

  const refreshKnownAccounts = useCallback(async () => {
    const list = await getKnownAccounts()
    setKnownAccounts(list)
  }, [])

  // Bootstrap: initialize CSPR.click once on mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const sdk = initCsprClick()
    if (sdk) {
      setSdkReady(true)
    }
  }, [])

  // Session restore: pick up the user's previously connected account from
  // CSPR.click local storage so refreshes don't break the workflow.
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!sdkReady) return
    let cancelled = false
    ;(async () => {
      try {
        const restored = await getActiveAccount()
        if (cancelled) return
        if (restored) {
          setAccount(restored)
          if (user?.id && restored.publicKey !== dbUser?.wallet_address) {
            try {
              await saveWalletToUser(user.id, restored.publicKey)
              await syncUser()
            } catch (err) {
              console.warn("[agent-wallet] session restore sync failed:", err)
            }
          }
        }
        await refreshKnownAccounts()
      } catch (err) {
        console.warn("[agent-wallet] session restore failed:", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sdkReady, user?.id, dbUser?.wallet_address, syncUser, refreshKnownAccounts])

  // Refresh on modal open + when the underlying public key changes
  useEffect(() => {
    if (open && (account?.publicKey || dbUser?.wallet_address)) {
      refreshBalance(account?.publicKey || dbUser?.wallet_address)
      refreshKnownAccounts()
    }
  }, [open, account?.publicKey, dbUser?.wallet_address, refreshBalance, refreshKnownAccounts])

  const handleConnect = async () => {
    if (!user?.id) {
      toast({ title: "Error", description: "User not authenticated", variant: "destructive" })
      return
    }
    if (!sdkReady) {
      toast({
        title: "CSPR.click unavailable",
        description: "The wallet connector is still loading. Refresh and try again.",
        variant: "destructive",
      })
      return
    }
    setIsConnecting(true)
    try {
      const connected = await connectWallet(ACTIVE_PROVIDER)
      if (!connected) {
        toast({
          title: "Connection cancelled",
          description: "You declined the wallet connection. Nothing was changed.",
        })
        return
      }
      setAccount(connected)
      await saveWalletToUser(user.id, connected.publicKey)
      await syncUser()
      await refreshBalance(connected.publicKey)
      await refreshKnownAccounts()
      toast({
        title: "Wallet connected",
        description: `Connected to ${connected.publicKey.slice(0, 10)}…${connected.publicKey.slice(-6)}`,
      })
    } catch (err) {
      const mapped = mapCsprClickError(err)
      toast({ title: mapped.title, description: mapped.message, variant: "destructive" })
    } finally {
      setIsConnecting(false)
    }
  }

  const handleSwitchAccount = async (next: ConnectedAccount) => {
    if (next.publicKey === account?.publicKey) return
    setIsConnecting(true)
    try {
      await switchAccount(next.publicKey, next.provider)
      setAccount(next)
      if (user?.id) {
        await saveWalletToUser(user.id, next.publicKey)
        await syncUser()
      }
      await refreshBalance(next.publicKey)
      toast({
        title: "Account switched",
        description: `Now signing with ${next.publicKey.slice(0, 10)}…${next.publicKey.slice(-6)}`,
      })
    } catch (err) {
      const mapped = mapCsprClickError(err)
      toast({ title: mapped.title, description: mapped.message, variant: "destructive" })
    } finally {
      setIsConnecting(false)
    }
  }

  const copyAddress = () => {
    const pk = account?.publicKey || dbUser?.wallet_address
    if (!pk) return
    navigator.clipboard.writeText(pk)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast({ title: "Copied", description: "Wallet public key copied to clipboard" })
  }

  const handleRemoveWallet = async () => {
    if (!user?.id) return
    setIsRemoving(true)
    try {
      await disconnectWallet(ACTIVE_PROVIDER)
      await removeWalletFromUser(user.id)
      await syncUser()
      setAccount(null)
      setBalance(null)
      toast({ title: "Wallet disconnected", description: "Your wallet has been removed." })
      setShowDeleteDialog(false)
    } catch (err) {
      const mapped = mapCsprClickError(err)
      toast({ title: mapped.title, description: mapped.message, variant: "destructive" })
    } finally {
      setIsRemoving(false)
    }
  }

  const handleClaimFunds = () => {
    window.open(chainConfig.faucetUrl, "_blank")
  }

  const publicKey = account?.publicKey || dbUser?.wallet_address
  const hasWallet = !!publicKey
  const displayBalance = balance ?? "0.00"
  const balanceIsLow = balance !== null && Number(balance) < 1

  return (
    <>
      {!hideButton && (
        <Button
          variant="outline"
          size="lg"
          onClick={() => onOpenChange(true)}
          className="gap-2"
        >
          {hasWallet ? (
            <>
              <span className="font-semibold">{displayBalance} {chainConfig.symbol}</span>
              {balanceIsLow && <CircleAlert className="h-4 w-4 text-amber-500" />}
            </>
          ) : (
            <>
              <Wallet className="h-5 w-5" />
              <span className="font-semibold">Connect Casper Wallet</span>
            </>
          )}
        </Button>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Agent Wallet
            </DialogTitle>
            <DialogDescription>
              Sign and broadcast Casper deploys via CSPR.click. Your wallet stays in your browser — BlockOps only stores the public key.
            </DialogDescription>
          </DialogHeader>

          {hasWallet ? (
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Network</Label>
                <div className="rounded-md border bg-muted px-3 py-2 text-sm">
                  {chainConfig.name}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Public Key</Label>
                  {knownAccounts.length > 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                          Switch <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-w-[320px]">
                        <DropdownMenuLabel>Connected accounts</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {knownAccounts.map((acct) => (
                          <DropdownMenuItem
                            key={acct.publicKey}
                            onSelect={() => handleSwitchAccount(acct)}
                            disabled={isConnecting}
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-xs">
                                {acct.publicKey.slice(0, 12)}…{acct.publicKey.slice(-6)}
                              </span>
                              {acct.csprName ? (
                                <span className="text-[10px] text-muted-foreground">{acct.csprName}</span>
                              ) : null}
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-muted p-3 rounded-md break-all">
                    {publicKey}
                  </code>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={copyAddress} title="Copy public key">
                    {copied ? <Check className="h-4 w-4 text-foreground" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-muted-foreground text-center block">Balance</Label>
                <div className="flex items-center justify-center gap-3">
                  <div className="text-5xl font-bold leading-none">{displayBalance}</div>
                  <div className="text-sm text-muted-foreground font-medium">{chainConfig.symbol}</div>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Via CSPR.cloud · {chainConfig.name}
                </p>
                {balanceIsLow && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs flex items-center gap-2">
                    <CircleAlert className="h-3.5 w-3.5 text-amber-600" />
                    <span>Low balance — fund the account before signing more deploys.</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={handleClaimFunds} variant="default" className="w-full">
                  <Fuel className="h-4 w-4 mr-2" />
                  Claim CSPR from Faucet
                </Button>
                {publicKey && (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={casperExplorerUrl(publicKey)} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View on Explorer
                    </a>
                  </Button>
                )}
                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="destructive"
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Disconnect Wallet
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground text-center">
                No wallet connected. Use CSPR.click to bring your existing Casper wallet (Casper Wallet, Ledger, MetaMask Snap, WalletConnect) or create a new one.
              </p>
              <Button onClick={handleConnect} disabled={isConnecting || !sdkReady} className="w-full">
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4 mr-2" />
                    Connect Casper Wallet
                  </>
                )}
              </Button>
              {!sdkReady && (
                <p className="text-xs text-center text-muted-foreground">
                  Initializing CSPR.click…
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Your wallet's public key will be removed from this account. You can re-connect any time via CSPR.click. Your funds stay safe in your wallet — only the connection is severed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveWallet}
              disabled={isRemoving}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isRemoving ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className}>{children}</label>
}

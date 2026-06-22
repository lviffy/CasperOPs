"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Wallet, Plus, Download, Copy, Check, Trash2, ExternalLink } from "lucide-react"
import Image from "next/image"
import { useAuth } from "@/lib/auth"
import {
  createWallet,
  getAddressFromPrivateKey,
  isValidPrivateKey,
  saveWalletToUser,
  getTokenBalancesForChain,
  removeWalletFromUser,
} from "@/lib/wallet"
import { toast } from "@/components/ui/use-toast"
import { CHAIN_CONFIGS, getStoredChain, normalizeChainId, setStoredChain, type SupportedChainId } from "@/lib/chains"

interface AgentWalletModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hideButton?: boolean
}

export function AgentWalletModal({ open, onOpenChange, hideButton = false }: AgentWalletModalProps) {
  const { user, dbUser, syncUser, loading } = useAuth()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [privateKeyInput, setPrivateKeyInput] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [newPrivateKey, setNewPrivateKey] = useState<string | null>(null)
  const [selectedChain, setSelectedChain] = useState<SupportedChainId>("flow-testnet")
  const [tokenBalances, setTokenBalances] = useState<{ native: string; symbol: string } | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const fetchBalances = useCallback(async () => {
    if (!dbUser?.wallet_address) return
    try {
      const balances = await getTokenBalancesForChain(dbUser.wallet_address, selectedChain)
      setTokenBalances(balances)
    } catch (error) {
      console.error("Error fetching balances:", error)
    }
  }, [dbUser?.wallet_address, selectedChain])

  useEffect(() => {
    setSelectedChain(getStoredChain())
  }, [])

  // Fetch balances immediately when component mounts and user has a wallet
  useEffect(() => {
    if (dbUser?.wallet_address && !newPrivateKey) {
      fetchBalances()
    }
  }, [dbUser?.wallet_address, newPrivateKey, fetchBalances])

  // Also refresh balance when modal opens to ensure it's up-to-date
  useEffect(() => {
    if (open && dbUser?.wallet_address && !newPrivateKey) {
      fetchBalances()
    }
  }, [open, dbUser?.wallet_address, newPrivateKey, fetchBalances])

  const handleCreateWallet = async () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      })
      return
    }

    setIsCreating(true)
    try {
      const wallet = createWallet()
      await saveWalletToUser(user.id, wallet.address, wallet.privateKey)
      setIsCreating(false)
      setNewPrivateKey(wallet.privateKey)
    } catch (error: any) {
      toast({
        title: "Error creating wallet",
        description: error.message || "Failed to create wallet",
        variant: "destructive",
      })
      setIsCreating(false)
    }
  }

  const handleImportWallet = async () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      })
      return
    }

    if (!privateKeyInput.trim()) {
      toast({
        title: "Invalid input",
        description: "Please enter a private key",
        variant: "destructive",
      })
      return
    }

    const cleanKey = privateKeyInput.trim().startsWith("0x")
      ? privateKeyInput.trim()
      : `0x${privateKeyInput.trim()}`

    if (!isValidPrivateKey(cleanKey)) {
      toast({
        title: "Invalid private key",
        description: "Please enter a valid private key",
        variant: "destructive",
      })
      return
    }

    setIsImporting(true)
    try {
      const address = getAddressFromPrivateKey(cleanKey)
      await saveWalletToUser(user.id, address, cleanKey)
      await syncUser()
      toast({
        title: "Wallet imported",
        description: "Your wallet has been imported successfully",
      })
      setShowImportDialog(false)
      setPrivateKeyInput("")
    } catch (error: any) {
      toast({
        title: "Error importing wallet",
        description: error.message || "Failed to import wallet",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  const copyAddress = () => {
    if (dbUser?.wallet_address) {
      navigator.clipboard.writeText(dbUser.wallet_address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: "Copied",
        description: "Wallet address copied to clipboard",
      })
    }
  }

  const handleRemoveWallet = async () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      })
      return
    }

    setIsRemoving(true)
    try {
      await removeWalletFromUser(user.id)
      await syncUser()
      setTokenBalances(null)
      toast({
        title: "Wallet removed",
        description: "Your wallet has been removed successfully",
      })
      setShowDeleteDialog(false)
    } catch (error: any) {
      toast({
        title: "Error removing wallet",
        description: error.message || "Failed to remove wallet",
        variant: "destructive",
      })
    } finally {
      setIsRemoving(false)
    }
  }

  const handleClaimFunds = () => {
    window.open(CHAIN_CONFIGS[selectedChain].faucetUrl, "_blank")
  }

  // Get balance for display in button
  const displayBalance = tokenBalances?.native || "0.00"
  const hasWallet = !!dbUser?.wallet_address
  const selectedChainConfig = CHAIN_CONFIGS[selectedChain]

  return (
    <>
      {/* Wallet Button - Shows in header */}
      {!hideButton && (
        <Button
          variant="outline"
          size="lg"
          onClick={() => onOpenChange(true)}
          className="gap-2"
        >
          {hasWallet ? (
            <>
              <div className="relative w-5 h-5 shrink-0">
                <Image
                  src="/stt-logo.png"
                  alt={selectedChainConfig.symbol}
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
              <span className="font-semibold">{displayBalance} {selectedChainConfig.symbol}</span>
            </>
          ) : (
            <>
              <Wallet className="h-5 w-5" />
              <span className="font-semibold">Add Wallet</span>
            </>
          )}
        </Button>
      )}

      {/* Main Wallet Modal */}
      <Dialog open={open && !showCreateDialog && !showImportDialog && !newPrivateKey} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Agent Wallet
            </DialogTitle>
          </DialogHeader>

          {dbUser?.wallet_address ? (
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Network</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedChain}
                  onChange={(event) => {
                    const nextChain = normalizeChainId(event.target.value)
                    setSelectedChain(nextChain)
                    setStoredChain(nextChain)
                  }}
                >
                  {Object.values(CHAIN_CONFIGS).map((chain) => (
                    <option key={chain.id} value={chain.id}>
                      {chain.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Wallet Address */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Wallet Address</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm bg-muted p-3 rounded-md break-all">
                    {dbUser.wallet_address}
                  </code>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={copyAddress} title="Copy address">
                    {copied ? <Check className="h-4 w-4 text-foreground" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Balance */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-muted-foreground text-center block">Balance</Label>
                <div className="flex items-center justify-center gap-3">
                  <div className="relative w-12 h-12 shrink-0">
                    <Image
                      src="/stt-logo.png"
                      alt={selectedChainConfig.symbol}
                      fill
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-4xl font-bold leading-none">
                      {tokenBalances?.native || "0.00"}
                    </div>
                    <div className="text-sm text-muted-foreground font-medium">
                      {selectedChainConfig.symbol}
                    </div>
                  </div>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Viewing balances on {selectedChainConfig.name}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={handleClaimFunds} variant="default" className="w-full">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Claim Funds
                </Button>
                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="destructive"
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove Wallet
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground text-center">
                No wallet configured. Create or import a wallet to get started.
              </p>
              <div className="flex flex-col gap-2">
                <Button onClick={() => setShowCreateDialog(true)} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Wallet
                </Button>
                <Button onClick={() => setShowImportDialog(true)} variant="outline" className="w-full">
                  <Download className="h-4 w-4 mr-2" />
                  Import Wallet
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Wallet Dialog */}
      <Dialog
        open={showCreateDialog || !!newPrivateKey}
        onOpenChange={(open) => {
          if (!open && newPrivateKey) {
            return
          }
          if (open) {
            setShowCreateDialog(true)
          } else {
            setShowCreateDialog(false)
            setNewPrivateKey(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(e) => {
            if (newPrivateKey) {
              e.preventDefault()
            }
          }}
          onPointerDownOutside={(e) => {
            if (newPrivateKey) {
              e.preventDefault()
            }
          }}
          onInteractOutside={(e) => {
            if (newPrivateKey) {
              e.preventDefault()
            }
          }}
        >
          {newPrivateKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Wallet Created Successfully</DialogTitle>
                <DialogDescription>
                  Save your private key securely - you won't be able to see it again.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-4">
                <Label>Private Key</Label>
                <div className="flex items-center gap-2">
                  <Input value={newPrivateKey} readOnly className="font-mono text-sm" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(newPrivateKey)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-foreground" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={async () => {
                    setNewPrivateKey(null)
                    setShowCreateDialog(false)
                    await syncUser()
                  }}
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create Agent Wallet</DialogTitle>
                <DialogDescription>
                  A new wallet will be generated for your agent. Make sure to securely store your private key.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateWallet} disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Wallet"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Import Wallet Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Wallet</DialogTitle>
            <DialogDescription>Enter your private key to import an existing wallet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="privateKey">Private Key</Label>
              <Input
                id="privateKey"
                type="password"
                placeholder="0x..."
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your private key will be encrypted and stored securely.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowImportDialog(false)
                setPrivateKeyInput("")
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleImportWallet} disabled={isImporting}>
              {isImporting ? "Importing..." : "Import Wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Wallet?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove your agent wallet? This will delete your wallet address and private key
              from your account. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveWallet}
              disabled={isRemoving}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isRemoving ? "Removing..." : "Remove Wallet"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

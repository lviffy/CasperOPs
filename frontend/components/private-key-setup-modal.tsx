"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Key,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet as WalletIcon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { updateCompatibleUserWallet, type WalletType } from "@/lib/supabase"
import { toast } from "@/components/ui/use-toast"
import { connectWallet, getActiveAccount, saveWalletToUser } from "@/lib/wallet"
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from "@/lib/chains"

interface PrivateKeySetupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  onComplete: () => void
  pkpSchemaReady?: boolean
}

const DEFAULT_TAB: WalletType = "csprclick"

export function PrivateKeySetupModal({
  open,
  onOpenChange,
  userId,
  onComplete,
  pkpSchemaReady = true,
}: PrivateKeySetupModalProps) {
  const [activeTab, setActiveTab] = useState<WalletType>(DEFAULT_TAB)
  const [isConnecting, setIsConnecting] = useState(false)
  const [csprPublicKey, setCsprPublicKey] = useState<string | null>(null)
  const [provider, setProvider] = useState<string>("casper-wallet")
  const [error, setError] = useState<string | null>(null)

  const isLoading = isConnecting
  const chain = CHAIN_CONFIGS[DEFAULT_CHAIN_ID]

  const canDismiss = useMemo(() => !isLoading, [isLoading])

  const resetState = () => {
    setActiveTab(DEFAULT_TAB)
    setIsConnecting(false)
    setCsprPublicKey(null)
    setError(null)
  }

  useEffect(() => {
    if (open) {
      setActiveTab(DEFAULT_TAB)
      setError(null)
    }
  }, [open, pkpSchemaReady])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const account = await getActiveAccount()
        if (cancelled) return
        if (account?.publicKey) {
          setCsprPublicKey(account.publicKey)
          setProvider(account.provider || "casper-wallet")
        }
      } catch (err) {
        // Silent: user is just not connected.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen && !canDismiss) return
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  const handleConnect = async (selectedProvider: string) => {
    setError(null)
    setIsConnecting(true)
    setProvider(selectedProvider)
    try {
      const account = await connectWallet(selectedProvider)
      if (!account?.publicKey) {
        throw new Error("Wallet connection was cancelled.")
      }

      await saveWalletToUser(userId, account.publicKey)
      await updateCompatibleUserWallet(userId, {
        wallet_address: account.publicKey,
        private_key: null,
        wallet_type: "csprclick",
        pkp_public_key: null,
        pkp_token_id: null,
      } as any)

      setCsprPublicKey(account.publicKey)
      toast({
        title: "CSPR.click wallet connected",
        description: `Your ${chain.symbol} account is now bound to your CasperOPs identity.`,
      })
      onComplete()
    } catch (connectError: any) {
      console.error("Error connecting CSPR.click wallet:", connectError)
      setError(
        connectError?.message ||
          "Failed to connect your Casper wallet. Install the Casper Wallet extension or try a different provider.",
      )
    } finally {
      setIsConnecting(false)
    }
  }

  const handleSkip = () => {
    resetState()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WalletIcon className="h-5 w-5" />
            Connect a Casper Wallet
          </DialogTitle>
          <DialogDescription>
            CasperOPs signs every on-chain interaction with your CSPR.click wallet — no seed phrases
            or raw private keys are ever stored in Supabase.
          </DialogDescription>
        </DialogHeader>

        {!pkpSchemaReady && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your Supabase users table is missing the legacy wallet columns. We only need
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">wallet_address</code>
              and
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">wallet_type</code> now;
              CSPR.click will populate them for you.
            </AlertDescription>
          </Alert>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as WalletType)
            setError(null)
          }}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-1">
            <TabsTrigger value="csprclick" className="gap-2">
              <Sparkles className="h-4 w-4" />
              CSPR.click (Casper Wallet)
              <Badge variant="secondary" className="ml-1 hidden sm:inline-flex">
                Recommended
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="csprclick" className="space-y-4">
            <Alert className="border-emerald-500/30 bg-emerald-500/5">
              <Sparkles className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Flagship experience:</strong> CSPR.click connects directly to the Casper
                Wallet, Ledger, or signer you already use. Your public key is saved to Supabase so
                the CasperOPs backend can route deploys to you, but the secret key never leaves the
                wallet.
              </AlertDescription>
            </Alert>

            {csprPublicKey ? (
              <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Wallet connected</p>
                    <p className="text-xs text-muted-foreground">
                      CasperOPs will sign deploys on {chain.chainName} with this account.
                    </p>
                  </div>
                </div>

                <div className="space-y-1 rounded-lg bg-background/70 p-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Public Key
                  </Label>
                  <p className="break-all font-mono text-xs">{csprPublicKey}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSkip}
                    className="flex-1"
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleConnect(provider)}
                    className="flex-1"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Reconnecting…
                      </>
                    ) : (
                      "Reconnect"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Choose a Casper wallet provider</p>
                  <p className="text-sm text-muted-foreground">
                    Each provider opens its native popup so you can confirm the connection. We
                    only receive your public key, balance, and CSPR name.
                  </p>
                </div>

                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li>Stores <code>wallet_type = "csprclick"</code> and the public key.</li>
                  <li>No seed phrases, no Lit ciphertext, no EOA private keys.</li>
                  <li>Required for on-chain agent registration and x402 tool payments.</li>
                </ul>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { id: "casper-wallet", label: "Casper Wallet" },
                    { id: "casper-signer", label: "Casper Signer" },
                    { id: "ledger", label: "Ledger" },
                    { id: "walletconnect", label: "WalletConnect" },
                  ].map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      onClick={() => handleConnect(p.id)}
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading && provider === p.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Connecting…
                        </>
                      ) : (
                        <>
                          <WalletIcon className="mr-2 h-4 w-4" />
                          {p.label}
                        </>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Your secret key never leaves the Casper wallet.
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            disabled={isLoading}
          >
            Skip for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

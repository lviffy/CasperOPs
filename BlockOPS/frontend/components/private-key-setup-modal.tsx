"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { updateCompatibleUserWallet, type WalletType } from "@/lib/supabase"
import { toast } from "@/components/ui/use-toast"
import { encryptPrivateKeyForStorage, normalizePrivateKey } from "@/lib/lit-private-key"
import { createWallet } from "@/lib/wallet"
import { mintPkpWallet, type PkpWalletResult } from "@/lib/lit-pkp"

interface PrivateKeySetupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  onComplete: () => void
  pkpSchemaReady?: boolean
}

const DEFAULT_TAB: WalletType = "pkp"

export function PrivateKeySetupModal({
  open,
  onOpenChange,
  userId,
  onComplete,
  pkpSchemaReady = true,
}: PrivateKeySetupModalProps) {
  const [activeTab, setActiveTab] = useState<WalletType>(pkpSchemaReady ? DEFAULT_TAB : "traditional")
  const [privateKey, setPrivateKey] = useState("")
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [isTraditionalLoading, setIsTraditionalLoading] = useState(false)
  const [isPkpLoading, setIsPkpLoading] = useState(false)
  const [pkpResult, setPkpResult] = useState<PkpWalletResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isLoading = isTraditionalLoading || isPkpLoading
  const hasTraditionalInput = privateKey.trim().length > 0

  const canDismiss = useMemo(() => !isLoading, [isLoading])

  const resetState = () => {
    setActiveTab(pkpSchemaReady ? DEFAULT_TAB : "traditional")
    setPrivateKey("")
    setShowPrivateKey(false)
    setIsTraditionalLoading(false)
    setIsPkpLoading(false)
    setPkpResult(null)
    setError(null)
  }

  const pkpSchemaMessage =
    "Your Supabase users table is still on the old schema. Run frontend/MIGRATION_FIX.sql in Supabase, refresh the app, and the PKP tab will be fully enabled."

  useEffect(() => {
    if (open) {
      setActiveTab(pkpSchemaReady ? DEFAULT_TAB : "traditional")
      setError(null)
    }
  }, [open, pkpSchemaReady])

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen && !canDismiss) {
      return
    }

    if (!nextOpen) {
      resetState()
    }

    onOpenChange(nextOpen)
  }

  const validatePrivateKey = (key: string): boolean => {
    const cleanKey = key.startsWith("0x") ? key.slice(2) : key
    return /^[0-9a-fA-F]{64}$/.test(cleanKey)
  }

  const handleGenerateTraditionalKey = () => {
    const wallet = createWallet()
    setPrivateKey(wallet.privateKey)
    setShowPrivateKey(true)
    setError(null)
  }

  const handleTraditionalSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!privateKey.trim()) {
      setError("Please enter or generate a private key first.")
      return
    }

    if (!validatePrivateKey(privateKey.trim())) {
      setError(
        "Invalid private key format. Please enter a valid 64-character hexadecimal private key with or without the 0x prefix."
      )
      return
    }

    setIsTraditionalLoading(true)

    try {
      const formattedKey = normalizePrivateKey(privateKey.trim())
      const { ethers } = await import("ethers")
      const wallet = new ethers.Wallet(formattedKey)
      const litEncryptedPayload = await encryptPrivateKeyForStorage(formattedKey)

      await updateCompatibleUserWallet(userId, {
        private_key: litEncryptedPayload,
        wallet_address: wallet.address,
        wallet_type: "traditional",
        pkp_public_key: null,
        pkp_token_id: null,
      })

      toast({
        title: "Traditional wallet secured",
        description: "Your private key is now encrypted with Lit before storage.",
      })

      resetState()
      onComplete()
      onOpenChange(false)
    } catch (submitError: any) {
      console.error("Error setting up traditional wallet:", submitError)
      setError(
        submitError?.message ||
          "Failed to secure and store your private key. Please check your key and Lit configuration, then try again."
      )
    } finally {
      setIsTraditionalLoading(false)
    }
  }

  const handleGeneratePkp = async () => {
    setError(null)

    if (!pkpSchemaReady) {
      setError(pkpSchemaMessage)
      return
    }

    setIsPkpLoading(true)

    try {
      const mintedWallet = await mintPkpWallet()

      await updateCompatibleUserWallet(userId, {
        private_key: null,
        wallet_address: mintedWallet.walletAddress,
        wallet_type: "pkp",
        pkp_public_key: mintedWallet.pkpPublicKey,
        pkp_token_id: mintedWallet.pkpTokenId,
      })

      setPkpResult(mintedWallet)
      onComplete()

      toast({
        title: "PKP wallet created",
        description: "Your Lit-powered decentralized wallet is live on naga-test with no seed exposed.",
      })
    } catch (pkpError: any) {
      console.error("Error minting PKP wallet:", pkpError)
      setError(
        pkpError?.message ||
          "Failed to mint your PKP wallet. Make sure the Lit Naga testnet controller wallet is configured and funded, then try again."
      )
    } finally {
      setIsPkpLoading(false)
    }
  }

  const handleSkip = () => {
    resetState()
    onOpenChange(false)
  }

  const handleContinueAfterPkp = () => {
    resetState()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Set Up Agent Wallet
          </DialogTitle>
          <DialogDescription>
            Generate a true decentralized PKP wallet powered by Lit Protocol&apos;s Naga testnet with no seed ever exposed, or keep the legacy encrypted-key flow for an existing wallet.
          </DialogDescription>
        </DialogHeader>

        {!pkpSchemaReady && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{pkpSchemaMessage}</AlertDescription>
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pkp" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Create PKP Wallet
              <Badge variant="secondary" className="ml-1 hidden sm:inline-flex">
                Recommended
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="traditional" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              Import Existing Wallet
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pkp" className="space-y-4">
            <Alert className="border-emerald-500/30 bg-emerald-500/5">
              <Sparkles className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Flagship experience:</strong> mint a new Lit PKP through distributed key
                generation on the Naga testnet. We only store the PKP public key and tokenId in
                Supabase, never any raw wallet secret.
              </AlertDescription>
            </Alert>

            {pkpResult ? (
              <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">PKP wallet created successfully</p>
                    <p className="text-xs text-muted-foreground">
                      Your new seedless wallet is ready for both the web app and Telegram signing
                      flow.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg bg-background/70 p-3">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Wallet Address
                    </Label>
                    <p className="break-all font-mono text-xs">{pkpResult.walletAddress}</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      PKP Public Key
                    </Label>
                    <p className="break-all font-mono text-xs">{pkpResult.pkpPublicKey}</p>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      PKP Token ID
                    </Label>
                    <p className="break-all font-mono text-xs">{pkpResult.pkpTokenId}</p>
                  </div>
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
                  <Button type="button" onClick={handleContinueAfterPkp} className="flex-1">
                    Continue
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Create a Lit PKP wallet</p>
                  <p className="text-sm text-muted-foreground">
                    This creates an ERC-721 PKP on Lit&apos;s Naga testnet and uses it as your
                    agent signer. No seed phrase or raw private key is ever exposed in the UI or
                    stored in Supabase.
                  </p>
                </div>

                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li>Stores `wallet_type = "pkp"` plus the PKP public key and tokenId.</li>
                  <li>Uses the PKP directly for future signing flows instead of decrypting a key.</li>
                  <li>Keeps the legacy encrypted-key path available for existing wallets.</li>
                </ul>

                <Button
                  type="button"
                  onClick={handleGeneratePkp}
                  disabled={isLoading || !pkpSchemaReady}
                  className="w-full"
                >
                  {isPkpLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating PKP on naga-test...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate PKP
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="traditional" className="space-y-4">
            <form onSubmit={handleTraditionalSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="privateKey">Private Key</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerateTraditionalKey}
                    disabled={isLoading}
                    className="h-8 px-2 text-xs"
                  >
                    Generate New EOA Key
                  </Button>
                </div>

                <div className="relative">
                  <Input
                    id="privateKey"
                    type={showPrivateKey ? "text" : "password"}
                    placeholder="0x... or paste your 64-character hex key"
                    value={privateKey}
                    onChange={(event) => {
                      setPrivateKey(event.target.value)
                      setError(null)
                    }}
                    disabled={isLoading}
                    className="pr-10"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPrivateKey((current) => !current)}
                    disabled={isLoading}
                  >
                    {showPrivateKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  This legacy flow still works exactly as before: your EOA private key is encrypted
                  with Lit and stored as a `lit:v1:` payload.
                </p>
              </div>

              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  We never store plaintext keys in Supabase. Only Lit-encrypted ciphertext is
                  persisted, and the decrypted key is resolved just-in-time for traditional signing
                  flows.
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSkip}
                  disabled={isLoading}
                  className="flex-1"
                >
                  Skip for Now
                </Button>
                <Button type="submit" disabled={isLoading || !hasTraditionalInput} className="flex-1">
                  {isTraditionalLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Securing Wallet...
                    </>
                  ) : (
                    "Save Traditional Wallet"
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  )
}

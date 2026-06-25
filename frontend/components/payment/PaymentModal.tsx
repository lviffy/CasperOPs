"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Loader2, Wallet, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { sendDeploy, casperDeployUrl, fetchCsprBalance } from "@/lib/wallet"
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from "@/lib/chains"
import { toast } from "@/components/ui/use-toast"
import { PaymentAgreementModal } from "./PaymentAgreementModal"

interface PaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  toolName: string
  toolDisplayName: string
  price: string
  agentId?: string
  onPaymentSuccess?: (paymentHash: string, executionToken: string) => void
  onPaymentError?: (error: string) => void
}

type PaymentStatus = "idle" | "checking-balance" | "paying" | "verifying" | "success" | "error"

const CEP18_CONTRACT_HASH = process.env.NEXT_PUBLIC_CEP18_CONTRACT_HASH || ""
const PAYMENT_RECIPIENT = process.env.NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY || ""

export function PaymentModal({
  open,
  onOpenChange,
  toolName,
  toolDisplayName,
  price,
  agentId,
  onPaymentSuccess,
  onPaymentError,
}: PaymentModalProps) {
  const { user, authenticated, publicKey, isWalletLogin } = useAuth() as any
  const signerPublicKey = publicKey ?? user?.publicKey ?? null

  const [status, setStatus] = useState<PaymentStatus>("idle")
  const [error, setError] = useState<string>("")
  const [csprBalance, setCsprBalance] = useState<string>("")
  const [txHash, setTxHash] = useState<string>("")
  const [executionToken, setExecutionToken] = useState<string>("")
  const [hasAgreedToTerms, setHasAgreedToTerms] = useState<boolean>(false)
  const [showAgreementModal, setShowAgreementModal] = useState(false)

  useEffect(() => {
    if (open && authenticated && user) {
      checkPaymentAgreement()
    }
  }, [open, authenticated, user])

  const checkPaymentAgreement = async () => {
    if (!user?.id) return
    try {
      const response = await fetch(`/api/payments/agreement?userId=${user.id}&version=v1.0`)
      const data = await response.json()
      setHasAgreedToTerms(Boolean(data?.hasAgreed))
    } catch (err) {
      console.error("Error checking payment agreement:", err)
    }
  }

  useEffect(() => {
    if (open && signerPublicKey) {
      checkBalance()
    }
  }, [open, signerPublicKey])

  const checkBalance = async () => {
    if (!signerPublicKey) return
    setStatus("checking-balance")
    try {
      const bal = await fetchCsprBalance(signerPublicKey)
      setCsprBalance(bal ?? "0")
      setStatus("idle")
    } catch (err) {
      console.error("Error checking CSPR balance:", err)
      setError("Failed to check CSPR balance")
      setStatus("error")
    }
  }

  const handlePayment = async () => {
    if (!signerPublicKey) {
      setError("Please connect your Casper wallet via CSPR.click first")
      setStatus("error")
      return
    }

    if (!hasAgreedToTerms) {
      setError("Please accept payment terms first")
      setStatus("error")
      return
    }

    setStatus("paying")
    setError("")

    try {
      const priceNum = Number(price)
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        throw new Error(`Invalid price: ${price}`)
      }

      const amountMotes = BigInt(Math.round(priceNum * 1_000_000_000)).toString()

      const deployJson: any = {
        contractHash: CEP18_CONTRACT_HASH.startsWith("hash-")
          ? CEP18_CONTRACT_HASH
          : CEP18_CONTRACT_HASH
            ? `hash-${CEP18_CONTRACT_HASH}`
            : "",
        entryPoint: "transfer",
        args: {
          recipient: PAYMENT_RECIPIENT,
          amount: amountMotes,
        },
        signingPublicKey: signerPublicKey,
        chainName: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
        metadata: {
          toolName,
          toolDisplayName,
          agentId: agentId || "",
          priceCspr: price,
          paidAt: new Date().toISOString(),
        },
      }

      const sent = await sendDeploy(deployJson, signerPublicKey, true)
      const deployHash =
        (sent as any)?.deployHash ??
        (sent as any)?.deploy_hash ??
        (sent as any)?.hash ??
        ""

      if (!deployHash) {
        throw new Error("Wallet did not return a deploy hash")
      }

      setTxHash(deployHash)

      setStatus("verifying")

      const verifyResponse = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHash: deployHash,
          userId: user?.id,
          agentId: agentId || null,
          toolName,
          amountCspr: price,
        }),
      })

      if (!verifyResponse.ok) {
        const errData = await verifyResponse.json().catch(() => ({}))
        throw new Error(errData?.error || errData?.message || "Payment verification failed")
      }

      const verifyData = await verifyResponse.json()
      setExecutionToken(verifyData.executionToken || verifyData.token || "")
      setStatus("success")

      toast({
        title: "Payment Successful!",
        description: `Paid ${price} CSPR for ${toolDisplayName}.`,
      })

      if (onPaymentSuccess) {
        onPaymentSuccess(deployHash, verifyData.executionToken || verifyData.token || "")
      }
    } catch (err: any) {
      console.error("Payment error:", err)
      setError(err?.message || "Payment failed. Please try again.")
      setStatus("error")
      if (onPaymentError) onPaymentError(err?.message || "Payment failed")
    }
  }

  const handleClose = () => {
    if (status !== "paying" && status !== "verifying") {
      onOpenChange(false)
      setTimeout(() => {
        setStatus("idle")
        setError("")
        setTxHash("")
        setExecutionToken("")
      }, 300)
    }
  }

  const getStatusMessage = () => {
    switch (status) {
      case "checking-balance":
        return "Checking your CSPR balance..."
      case "paying":
        return "Confirm the CEP-18 transfer in CSPR.click..."
      case "verifying":
        return "Verifying payment deploy on-chain..."
      case "success":
        return "Payment successful!"
      case "error":
        return "Payment failed"
      default:
        return ""
    }
  }

  const isProcessing = ["checking-balance", "paying", "verifying"].includes(status)
  const canPay =
    status === "idle" &&
    !!signerPublicKey &&
    hasAgreedToTerms &&
    parseFloat(csprBalance || "0") >= parseFloat(price)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Pay for Tool Usage</DialogTitle>
          <DialogDescription>
            Complete payment to use <strong>{toolDisplayName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-bold">{price} CSPR</p>
            </div>
            <Badge variant="secondary">
              {CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName}
            </Badge>
          </div>

          {!signerPublicKey ? (
            <Alert>
              <Wallet className="h-4 w-4" />
              <AlertDescription>
                Connect a Casper wallet via CSPR.click to continue.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your Wallet</span>
                <span className="font-mono">
                  {signerPublicKey.slice(0, 6)}…{signerPublicKey.slice(-4)}
                </span>
              </div>
              {csprBalance && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">CSPR Balance</span>
                  <span
                    className={
                      parseFloat(csprBalance) >= parseFloat(price)
                        ? "text-green-500"
                        : "text-red-500"
                    }
                  >
                    {parseFloat(csprBalance).toFixed(2)} CSPR
                  </span>
                </div>
              )}
            </div>
          )}

          {!hasAgreedToTerms && !!signerPublicKey && (
            <Alert variant="default">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You must accept the payment terms before making a payment.{" "}
                <Button
                  variant="link"
                  className="h-auto p-0 text-primary"
                  onClick={() => setShowAgreementModal(true)}
                >
                  View Terms
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {status !== "idle" && (
            <Alert variant={status === "success" ? "default" : status === "error" ? "destructive" : "default"}>
              {status === "success" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {status === "error" && <XCircle className="h-4 w-4" />}
              {isProcessing && <Loader2 className="h-4 w-4 animate-spin" />}
              <AlertDescription>
                {getStatusMessage()}
                {error && <div className="mt-2 text-sm">{error}</div>}
              </AlertDescription>
            </Alert>
          )}

          {txHash && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Deploy:</span>
              <a
                href={casperDeployUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                {txHash.slice(0, 6)}…{txHash.slice(-4)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Payment is held in escrow until service is delivered</p>
            <p>• Automatic refund if service fails</p>
            <p>• Transaction will be on Casper {CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName}</p>
          </div>
        </div>

        <DialogFooter>
          {status === "success" ? (
            <Button onClick={handleClose} className="w-full">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
                Cancel
              </Button>
              <Button onClick={handlePayment} disabled={!canPay || isProcessing}>
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Pay {price} CSPR
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <PaymentAgreementModal
        open={showAgreementModal}
        onOpenChange={setShowAgreementModal}
        onAccepted={() => {
          setHasAgreedToTerms(true)
          checkPaymentAgreement()
        }}
      />
    </Dialog>
  )
}

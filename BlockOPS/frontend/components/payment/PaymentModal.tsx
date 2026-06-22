"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Loader2, Wallet, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useWallets } from "@privy-io/react-auth"
import { ethers } from "ethers"
import { toast } from "@/components/ui/use-toast"
import { PaymentAgreementModal } from "./PaymentAgreementModal"

interface PaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  toolName: string
  toolDisplayName: string
  price: string // e.g., "0.25"
  agentId?: string
  onPaymentSuccess?: (paymentHash: string, executionToken: string) => void
  onPaymentError?: (error: string) => void
}

type PaymentStatus = "idle" | "checking-balance" | "approving" | "waiting-approval" | "paying" | "verifying" | "success" | "error"

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
  const { user, authenticated } = useAuth()
  const { wallets } = useWallets()
  
  const [status, setStatus] = useState<PaymentStatus>("idle")
  const [error, setError] = useState<string>("")
  const [usdcBalance, setUsdcBalance] = useState<string>("")
  const [txHash, setTxHash] = useState<string>("")
  const [executionToken, setExecutionToken] = useState<string>("")
  const [hasAgreedToTerms, setHasAgreedToTerms] = useState<boolean>(false)
  const [showAgreementModal, setShowAgreementModal] = useState(false)

  // Arbitrum Sepolia configuration
  const ARBITRUM_SEPOLIA_CHAIN_ID = 421614
  const ARBITRUM_SEPOLIA_RPC = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"
  const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
  const PAYMENT_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS

  // USDC ABI (minimal - just what we need)
  const USDC_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]

  // Payment Contract ABI (minimal)
  const PAYMENT_ABI = [
    "function createPayment(address token, uint256 amount, string agentId, string toolName) payable returns (bytes32)",
  ]

  // Check if user has agreed to terms
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
      setHasAgreedToTerms(data.hasAgreed || false)
    } catch (error) {
      console.error("Error checking payment agreement:", error)
    }
  }

  // Check USDC balance when modal opens
  useEffect(() => {
    if (open && wallets.length > 0) {
      checkUSDCBalance()
    }
  }, [open, wallets])

  const checkUSDCBalance = async () => {
    if (wallets.length === 0) return

    setStatus("checking-balance")
    try {
      const wallet = wallets[0]
      const ethereumProvider = await wallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethereumProvider)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()

      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider)
      const balance = await usdcContract.balanceOf(address)
      const decimals = await usdcContract.decimals()
      
      const formattedBalance = ethers.formatUnits(balance, decimals)
      setUsdcBalance(formattedBalance)
      setStatus("idle")
    } catch (error) {
      console.error("Error checking USDC balance:", error)
      setError("Failed to check USDC balance")
      setStatus("error")
    }
  }

  const handlePayment = async () => {
    if (!wallets.length) {
      setError("Please connect your wallet first")
      setStatus("error")
      return
    }

    if (!PAYMENT_CONTRACT_ADDRESS) {
      setError("Payment contract not configured")
      setStatus("error")
      return
    }

    if (!hasAgreedToTerms) {
      setError("Please accept payment terms first")
      setStatus("error")
      return
    }

    try {
      const wallet = wallets[0]
      const ethereumProvider = await wallet.getEthereumProvider()
      const provider = new ethers.BrowserProvider(ethereumProvider)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()

      // Check network
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== ARBITRUM_SEPOLIA_CHAIN_ID) {
        setError(`Please switch to Arbitrum Sepolia network (Chain ID: ${ARBITRUM_SEPOLIA_CHAIN_ID})`)
        setStatus("error")
        return
      }

      // Parse amount
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider)
      const decimals = await usdcContract.decimals()
      const amount = ethers.parseUnits(price, decimals)

      // Check balance
      const balance = await usdcContract.balanceOf(address)
      if (balance < amount) {
        setError(`Insufficient USDC balance. You have ${ethers.formatUnits(balance, decimals)} USDC but need ${price} USDC`)
        setStatus("error")
        return
      }

      // Step 1: Approve USDC spending
      setStatus("approving")
      setError("")

      const allowance = await usdcContract.allowance(address, PAYMENT_CONTRACT_ADDRESS)
      
      if (allowance < amount) {
        const usdcWithSigner = usdcContract.connect(signer) as any
        const approveTx = await usdcWithSigner.approve(PAYMENT_CONTRACT_ADDRESS, amount)
        
        setStatus("waiting-approval")
        await approveTx.wait()
      }

      // Step 2: Create payment
      setStatus("paying")
      const paymentContract = new ethers.Contract(PAYMENT_CONTRACT_ADDRESS, PAYMENT_ABI, signer) as any
      
      const paymentTx = await paymentContract.createPayment(
        USDC_ADDRESS,
        amount,
        agentId || "",
        toolName
      )

      const receipt = await paymentTx.wait()
      const paymentHash = receipt.hash

      setTxHash(paymentHash)

      // Step 3: Verify payment with backend
      setStatus("verifying")
      
      const verifyResponse = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHash,
          userId: user?.id,
          agentId: agentId || null,
          toolName,
        }),
      })

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json()
        throw new Error(errorData.error || "Payment verification failed")
      }

      const verifyData = await verifyResponse.json()
      setExecutionToken(verifyData.executionToken)
      setStatus("success")

      toast({
        title: "Payment Successful!",
        description: `Your payment of ${price} USDC has been confirmed.`,
      })

      // Call success callback
      if (onPaymentSuccess) {
        onPaymentSuccess(paymentHash, verifyData.executionToken)
      }

    } catch (error: any) {
      console.error("Payment error:", error)
      setError(error.message || "Payment failed. Please try again.")
      setStatus("error")
      
      if (onPaymentError) {
        onPaymentError(error.message)
      }
    }
  }

  const handleClose = () => {
    if (status !== "paying" && status !== "approving" && status !== "waiting-approval") {
      onOpenChange(false)
      // Reset state after closing
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
        return "Checking your USDC balance..."
      case "approving":
        return "Please approve USDC spending in your wallet..."
      case "waiting-approval":
        return "Waiting for approval transaction..."
      case "paying":
        return "Processing payment..."
      case "verifying":
        return "Verifying payment on-chain..."
      case "success":
        return "Payment successful!"
      case "error":
        return "Payment failed"
      default:
        return ""
    }
  }

  const isProcessing = ["checking-balance", "approving", "waiting-approval", "paying", "verifying"].includes(status)
  const canPay = status === "idle" && wallets.length > 0 && hasAgreedToTerms && parseFloat(usdcBalance) >= parseFloat(price)

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
          {/* Price Display */}
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-bold">{price} USDC</p>
            </div>
            <Badge variant="secondary">Arbitrum Sepolia</Badge>
          </div>

          {/* Wallet Status */}
          {wallets.length === 0 ? (
            <Alert>
              <Wallet className="h-4 w-4" />
              <AlertDescription>
                Please connect your wallet to continue
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your Wallet</span>
                <span className="font-mono">{wallets[0].address.slice(0, 6)}...{wallets[0].address.slice(-4)}</span>
              </div>
              {usdcBalance && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">USDC Balance</span>
                  <span className={parseFloat(usdcBalance) >= parseFloat(price) ? "text-green-500" : "text-red-500"}>
                    {parseFloat(usdcBalance).toFixed(2)} USDC
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Terms Acceptance */}
          {!hasAgreedToTerms && wallets.length > 0 && (
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

          {/* Status Messages */}
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

          {/* Transaction Link */}
          {txHash && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Transaction:</span>
              <a
                href={`https://sepolia.arbiscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                {txHash.slice(0, 6)}...{txHash.slice(-4)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Info */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Payment is held in escrow until service is delivered</p>
            <p>• Automatic refund if service fails</p>
            <p>• Transaction will be on Arbitrum Sepolia testnet</p>
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
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handlePayment}
                disabled={!canPay || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Pay {price} USDC
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Payment Agreement Modal */}
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

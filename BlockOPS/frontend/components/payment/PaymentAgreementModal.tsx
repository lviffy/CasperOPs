"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText, Loader2, CheckCircle2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { toast } from "@/components/ui/use-toast"

interface PaymentAgreementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAccepted?: () => void
}

export function PaymentAgreementModal({ open, onOpenChange, onAccepted }: PaymentAgreementModalProps) {
  const { user } = useAuth()
  const [agreed, setAgreed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  const TERMS_VERSION = "v1.0"

  const handleAccept = async () => {
    if (!user?.id) {
      setError("Please sign in to accept terms")
      return
    }

    if (!agreed) {
      setError("Please check the box to agree to the terms")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      const response = await fetch("/api/payments/agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          version: TERMS_VERSION,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to record agreement")
      }

      toast({
        title: "Terms Accepted",
        description: "You can now make payments for premium features.",
      })

      onOpenChange(false)
      if (onAccepted) {
        onAccepted()
      }
    } catch (error: any) {
      console.error("Error recording agreement:", error)
      setError(error.message || "Failed to record agreement")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDecline = () => {
    setAgreed(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Payment Terms & Conditions
          </DialogTitle>
          <DialogDescription>
            Please review and accept the terms before making any payments
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] w-full rounded-md border p-4">
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="font-semibold text-base mb-2">BlockOps Payment Terms (Version {TERMS_VERSION})</h3>
              <p className="text-muted-foreground">Last Updated: November 23, 2025</p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">1. Payment Overview</h4>
              <p className="text-muted-foreground">
                BlockOps offers a mix of free and paid tools for blockchain automation. By accepting these terms, 
                you agree to pay for premium tools using USDC (USD Coin) on the Arbitrum Sepolia network.
              </p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">2. Free Usage Quota</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>You receive <strong>3 free AI workflow generations per day</strong></li>
                <li>The quota resets daily at midnight UTC</li>
                <li>Free quota applies to AI workflow generation only</li>
                <li>Other tool operations may require payment regardless of quota</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">3. Paid Features</h4>
              <p className="text-muted-foreground mb-2">
                Once you exceed your free quota or use premium tools, you must pay per usage:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>AI workflow generation (after free quota): $0.25 USDC per generation</li>
                <li>Premium blockchain tools: $0.25 - $5.00 USDC per operation</li>
                <li>Tool pricing is displayed before each operation</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">4. Payment Escrow</h4>
              <p className="text-muted-foreground">
                All payments are held in a secure smart contract escrow until service delivery:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Your payment is locked in escrow when you submit the transaction</li>
                <li>Funds are released to BlockOps only after successful tool execution</li>
                <li>If the service fails, funds are automatically refunded to your wallet</li>
                <li>Escrow provides security for both you and BlockOps</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">5. Refund Policy</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Automatic refund if tool execution fails due to system error</li>
                <li>No refund for successful tool executions</li>
                <li>Refunds are processed on-chain and returned to your wallet address</li>
                <li>Refund processing time: typically within 5-10 minutes</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">6. Network & Fees</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All payments must be made on <strong>Arbitrum Sepolia</strong> testnet</li>
                <li>You are responsible for network gas fees</li>
                <li>Gas fees are separate from tool payment amounts</li>
                <li>Ensure you have enough ETH for gas fees before initiating payment</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">7. Wallet Security</h4>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>You are solely responsible for your wallet security</li>
                <li>BlockOps never has access to your private keys</li>
                <li>Always verify transaction details before signing</li>
                <li>Use a secure wallet provider (e.g., MetaMask)</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">8. Service Availability</h4>
              <p className="text-muted-foreground">
                BlockOps strives for 99.9% uptime but does not guarantee uninterrupted service. 
                We are not liable for service interruptions, and no refunds are provided for 
                temporary unavailability.
              </p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">9. Data Collection</h4>
              <p className="text-muted-foreground">
                When you make a payment, we collect:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Transaction hash (public blockchain data)</li>
                <li>Your wallet address (public blockchain data)</li>
                <li>Payment amount and tool used</li>
                <li>IP address and user agent (for fraud prevention)</li>
                <li>Timestamp of agreement acceptance</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">10. Acceptable Use</h4>
              <p className="text-muted-foreground mb-2">You agree NOT to:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Abuse or exploit the free quota system</li>
                <li>Use automated scripts to create multiple accounts</li>
                <li>Reverse engineer or attack our smart contracts</li>
                <li>Use the service for illegal activities</li>
                <li>Submit fraudulent payment claims or refund requests</li>
              </ul>
            </section>

            <section>
              <h4 className="font-semibold mb-2">11. Limitation of Liability</h4>
              <p className="text-muted-foreground">
                BlockOps is provided "as-is" without warranties. We are not liable for any 
                indirect, incidental, or consequential damages arising from your use of the service, 
                including but not limited to loss of funds due to smart contract bugs, network issues, 
                or user error.
              </p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">12. Terms Updates</h4>
              <p className="text-muted-foreground">
                We may update these terms at any time. You will be notified of material changes 
                and must accept new terms before making further payments. Continued use after 
                updates constitutes acceptance.
              </p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">13. Dispute Resolution</h4>
              <p className="text-muted-foreground">
                Any disputes will be resolved through binding arbitration in accordance with 
                the laws of [Your Jurisdiction]. Blockchain transactions are immutable and 
                cannot be reversed once confirmed.
              </p>
            </section>

            <section>
              <h4 className="font-semibold mb-2">14. Contact</h4>
              <p className="text-muted-foreground">
                For questions or support regarding payments, contact us at: 
                <a href="mailto:support@blockops.io" className="text-primary hover:underline ml-1">
                  support@blockops.io
                </a>
              </p>
            </section>

            <section className="border-t pt-4 mt-6">
              <p className="text-xs text-muted-foreground italic">
                By checking the box below and clicking "Accept Terms", you acknowledge that you have 
                read, understood, and agree to be bound by these Payment Terms & Conditions.
              </p>
            </section>
          </div>
        </ScrollArea>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center space-x-2">
          <Checkbox 
            id="terms" 
            checked={agreed} 
            onCheckedChange={(checked) => setAgreed(checked === true)}
            disabled={isSubmitting}
          />
          <label
            htmlFor="terms"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            I have read and agree to the Payment Terms & Conditions (Version {TERMS_VERSION})
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={isSubmitting}
          >
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!agreed || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Accept Terms
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

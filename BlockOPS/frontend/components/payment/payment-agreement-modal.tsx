"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PaymentAgreementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: () => void;
}

const TERMS_VERSION = "v1.0";

export default function PaymentAgreementModal({
  isOpen,
  onClose,
  onAccept,
}: PaymentAgreementModalProps) {
  const { user } = usePrivy();
  const [hasRead, setHasRead] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = async () => {
    if (!hasRead || !hasAgreed) {
      toast.error("Please read and agree to the terms");
      return;
    }

    if (!user?.id) {
      toast.error("User not authenticated");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/payments/agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          version: TERMS_VERSION,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to record agreement");
      }

      toast.success("Terms accepted!");
      onAccept();
      onClose();
    } catch (err: any) {
      console.error("Error accepting terms:", err);
      toast.error(err.message || "Failed to accept terms");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Shield className="h-6 w-6 text-blue-600" />
            Payment Terms & Agreement
          </DialogTitle>
          <DialogDescription>
            Please review and accept our payment terms before proceeding
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] rounded-md border p-4">
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="font-semibold text-base mb-2">
                1. Free Usage Tier
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>You receive 3 free AI workflow generations per day</li>
                <li>Free tier resets daily at midnight UTC</li>
                <li>Certain tools are permanently free to use</li>
                <li>No payment required for free-tier services</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                2. Premium Features & Pricing
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  Premium tools and additional AI generations require payment
                </li>
                <li>Prices range from $0.25 to $5.00 USD in USDC</li>
                <li>Pricing is displayed before each transaction</li>
                <li>All payments are in USDC on Arbitrum Sepolia</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                3. Escrow Protection
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  All payments are held in a secure smart contract escrow
                </li>
                <li>
                  Funds are only released after successful service delivery
                </li>
                <li>
                  Automatic refund if service fails or cannot be delivered
                </li>
                <li>You maintain control over your funds until completion</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                4. Payment Process
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>You approve USDC spending (one-time per amount tier)</li>
                <li>You confirm payment transaction in your wallet</li>
                <li>Payment is held in escrow until service is delivered</li>
                <li>Upon success, payment is released to treasury</li>
                <li>If failed, payment is automatically refunded to you</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                5. Execution Tokens
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  After payment, you receive a temporary execution token (JWT)
                </li>
                <li>Token is valid for 30 minutes</li>
                <li>Token authorizes single use of paid feature</li>
                <li>Expired tokens will not execute services</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">6. Refund Policy</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Automatic refund if service cannot be delivered</li>
                <li>Automatic refund if blockchain transaction fails</li>
                <li>Manual refund requests reviewed case-by-case</li>
                <li>Refunds processed within 24-48 hours</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                7. Network & Fees
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>All transactions occur on Arbitrum Sepolia (testnet)</li>
                <li>You pay gas fees for blockchain transactions</li>
                <li>Gas fees are separate from service pricing</li>
                <li>Arbitrum offers low gas fees compared to Ethereum</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                8. Security & Privacy
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Your wallet address is never stored with private keys</li>
                <li>Payments are secured by audited smart contracts</li>
                <li>We record IP address and browser info for fraud prevention</li>
                <li>Transaction history is stored for your records</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                9. Service Availability
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Services are provided "as-is" without guarantees</li>
                <li>We strive for 99% uptime but cannot guarantee it</li>
                <li>Maintenance windows will be announced in advance</li>
                <li>Refunds issued for extended downtime</li>
              </ul>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                10. Changes to Terms
              </h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>We may update these terms periodically</li>
                <li>You will be notified of material changes</li>
                <li>Continued use implies acceptance of new terms</li>
                <li>
                  Current version: <strong>{TERMS_VERSION}</strong>
                </li>
              </ul>
            </section>

            <section className="pt-4 border-t">
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-900 dark:text-blue-200">
                    Important Notice
                  </p>
                  <p className="text-blue-800 dark:text-blue-300 mt-1">
                    By accepting these terms, you acknowledge that you have read,
                    understood, and agree to be bound by them. This agreement will
                    be recorded with your user ID, IP address, and timestamp for
                    legal purposes.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>

        <div className="space-y-3">
          {/* Read Confirmation */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="read"
              checked={hasRead}
              onCheckedChange={(checked) => setHasRead(checked === true)}
            />
            <label
              htmlFor="read"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              I have read and understood all terms above
            </label>
          </div>

          {/* Agreement Confirmation */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="agree"
              checked={hasAgreed}
              onCheckedChange={(checked) => setHasAgreed(checked === true)}
              disabled={!hasRead}
            />
            <label
              htmlFor="agree"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              I agree to the payment terms and conditions (Version {TERMS_VERSION}
              )
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!hasRead || !hasAgreed || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Accepting...
              </>
            ) : (
              "Accept Terms"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { sendDeploy, casperDeployUrl } from "@/lib/wallet";
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from "@/lib/chains";

const CEP18_CONTRACT_HASH = process.env.NEXT_PUBLIC_CEP18_CONTRACT_HASH || "";
const PAYMENT_RECIPIENT = process.env.NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY || "";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (executionToken: string, paymentId: string) => void;
  toolName: string;
  toolDisplayName: string;
  price: number;
  description?: string;
  agentId?: string;
}

type PaymentStep =
  | "idle"
  | "checking-balance"
  | "paying"
  | "waiting-payment"
  | "verifying"
  | "success"
  | "error";

export default function PaymentModal({
  isOpen,
  onClose,
  onSuccess,
  toolName,
  toolDisplayName,
  price,
  description,
  agentId,
}: PaymentModalProps) {
  const { user, authenticated } = useAuth();
  const publicKey = user?.publicKey ?? null;
  const [step, setStep] = useState<PaymentStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");

  const explorerUrl = (h: string) => casperDeployUrl(h);

  useEffect(() => {
    if (isOpen) {
      setStep("idle");
      setError(null);
      setTxHash(null);
      setPaymentId(null);
      if (publicKey) checkBalance();
    }
  }, [isOpen, publicKey]);

  const checkBalance = async () => {
    if (!publicKey) return;
    try {
      const res = await fetch(
        `${CHAIN_CONFIGS[DEFAULT_CHAIN_ID].csprCloudUrl.replace(/\/$/, "")}/accounts/${publicKey}/balance`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const motes = Number(data?.balance ?? data?.data?.balance ?? 0);
      setBalance((motes / 1_000_000_000).toFixed(4));
    } catch (err) {
      console.error("Error checking balance:", err);
    }
  };

  const handlePayment = async () => {
    if (!authenticated || !publicKey) {
      toast.error("Connect your Casper wallet via CSPR.click first");
      return;
    }

    try {
      setError(null);

      const generatedPaymentId = `${toolName}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}`;
      setPaymentId(generatedPaymentId);

      setStep("paying");

      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        throw new Error(`Invalid price: ${price}`);
      }

      const amountMotes = BigInt(Math.round(priceNum * 1_000_000_000)).toString();

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
        signingPublicKey: publicKey,
        chainName: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
        metadata: {
          toolName,
          paymentId: generatedPaymentId,
          agentId: agentId || "",
        },
      };

      const sent = await sendDeploy(deployJson, publicKey, true);
      const deployHash =
        (sent as any)?.deployHash ??
        (sent as any)?.deploy_hash ??
        (sent as any)?.hash ??
        "";

      if (!deployHash) {
        throw new Error("Wallet did not return a deploy hash");
      }

      setStep("waiting-payment");
      setTxHash(deployHash);
      toast.info("Payment deploy sent to Casper...");

      setStep("verifying");
      const response = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHash: deployHash,
          userId: user!.id,
          agentId,
          toolName,
          amountCspr: price,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.error || errData?.message || "Payment verification failed");
      }

      const data = await response.json();

      setStep("success");
      toast.success("Payment successful! 🎉");

      setTimeout(() => {
        onSuccess(data.executionToken || data.token || "", data.paymentId || generatedPaymentId);
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error("Payment error:", err);
      setStep("error");
      setError(err.message || "Payment failed");
      toast.error(err.message || "Payment failed");
    }
  };

  const getStepMessage = () => {
    switch (step) {
      case "checking-balance":
        return "Checking your CSPR balance...";
      case "paying":
        return "Confirm the CEP-18 transfer in CSPR.click...";
      case "waiting-payment":
        return "Waiting for the deploy to be processed on Casper...";
      case "verifying":
        return "Verifying payment on-chain...";
      case "success":
        return "Payment successful! 🎉";
      case "error":
        return error || "Something went wrong";
      default:
        return "";
    }
  };

  const isProcessing = ["checking-balance", "paying", "waiting-payment", "verifying"].includes(step);
  const isComplete = step === "success";
  const hasError = step === "error";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">💳</span>
            Payment Required
          </DialogTitle>
          <DialogDescription>
            Secure payment with Casper on-chain escrow
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4">
            <h3 className="font-semibold text-lg mb-1">{toolDisplayName}</h3>
            {description && (
              <p className="text-sm text-muted-foreground mb-3">
                {description}
              </p>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">{price.toFixed(2)}</span>
              <span className="text-muted-foreground">CSPR</span>
            </div>
          </div>

          {authenticated && (
            <div className="text-sm text-muted-foreground">
              Your balance: {parseFloat(balance).toFixed(2)} CSPR
            </div>
          )}

          {step !== "idle" && (
            <div
              className={`rounded-lg p-4 ${
                hasError
                  ? "bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-200"
                  : isComplete
                  ? "bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-200"
                  : "bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200"
              }`}
            >
              <div className="flex items-center gap-3">
                {isProcessing && <Loader2 className="h-5 w-5 animate-spin" />}
                {isComplete && <CheckCircle className="h-5 w-5" />}
                {hasError && <XCircle className="h-5 w-5" />}
                <span className="text-sm font-medium">{getStepMessage()}</span>
              </div>
            </div>
          )}

          {txHash && (
            <a
              href={explorerUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              View deploy on Casper Explorer
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-xl">🛡️</span>
            <div>
              <div className="font-medium text-foreground">
                Escrow Protection
              </div>
              <div className="text-xs">
                Funds held securely on Casper until service delivered
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePayment}
            disabled={isProcessing || isComplete}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : isComplete ? (
              "Complete!"
            ) : authenticated ? (
              "Pay with CSPR.click"
            ) : (
              "Connect Wallet"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ethers } from "ethers";
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

// Payment Escrow ABI (minimal - only what we need)
const PAYMENT_ESCROW_ABI = [
  "function createPayment(address token, uint256 amount, string memory paymentId) external payable returns (bytes32)",
  "function verifyPayment(bytes32 paymentHash) external view returns (bool, address, address, uint256, string memory)",
];

// USDC ABI (minimal)
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

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
  | "approving"
  | "waiting-approval"
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
  const { user, authenticated, login } = usePrivy();
  const [step, setStep] = useState<PaymentStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [balance, setBalance] = useState<string>("0");

  const contractAddress = process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS!;
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS!;
  const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL!;
  const chainId = parseInt(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_CHAIN_ID!);
  const explorerUrl = "https://sepolia.arbiscan.io";

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep("idle");
      setError(null);
      setTxHash(null);
      setPaymentId(null);
      setHasAllowance(false);
      checkBalance();
    }
  }, [isOpen]);

  const checkBalance = async () => {
    if (!authenticated || !user?.wallet?.address) return;

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
      const balance = await usdcContract.balanceOf(user.wallet.address);
      const formatted = ethers.formatUnits(balance, 6); // USDC has 6 decimals
      setBalance(formatted);

      // Check allowance
      const allowance = await usdcContract.allowance(
        user.wallet.address,
        contractAddress
      );
      const priceInWei = ethers.parseUnits(price.toString(), 6);
      setHasAllowance(allowance >= priceInWei);
    } catch (err) {
      console.error("Error checking balance:", err);
    }
  };

  const handlePayment = async () => {
    if (!authenticated || !user?.wallet?.address) {
      login();
      return;
    }

    try {
      setError(null);

      // Check if user needs to switch network
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== chainId) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${chainId.toString(16)}` }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            throw new Error(
              "Please add Arbitrum Sepolia network to your wallet"
            );
          }
          throw switchError;
        }
      }

      const signer = await provider.getSigner();
      const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
      const escrowContract = new ethers.Contract(
        contractAddress,
        PAYMENT_ESCROW_ABI,
        signer
      );

      const priceInWei = ethers.parseUnits(price.toString(), 6);

      // Generate unique payment ID
      const generatedPaymentId = `${toolName}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}`;
      setPaymentId(generatedPaymentId);

      // Step 1: Approve USDC if needed
      if (!hasAllowance) {
        setStep("approving");
        const approveTx = await usdcContract.approve(
          contractAddress,
          priceInWei
        );
        setStep("waiting-approval");
        toast.info("Waiting for USDC approval...");
        await approveTx.wait();
        setHasAllowance(true);
        toast.success("USDC approved!");
      }

      // Step 2: Create payment
      setStep("paying");
      const paymentTx = await escrowContract.createPayment(
        usdcAddress,
        priceInWei,
        generatedPaymentId
      );

      setStep("waiting-payment");
      setTxHash(paymentTx.hash);
      toast.info("Payment transaction sent...");

      const receipt = await paymentTx.wait();

      // Step 3: Verify payment and get execution token
      setStep("verifying");
      const response = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentHash: receipt.hash,
          userId: user.id,
          agentId,
          toolName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Payment verification failed");
      }

      const data = await response.json();

      setStep("success");
      toast.success("Payment successful! 🎉");

      // Wait a moment to show success state
      setTimeout(() => {
        onSuccess(data.executionToken, data.paymentId);
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
        return "Checking your USDC balance...";
      case "approving":
        return "Please approve USDC spending in your wallet...";
      case "waiting-approval":
        return "Waiting for approval confirmation...";
      case "paying":
        return "Please confirm payment in your wallet...";
      case "waiting-payment":
        return "Processing payment transaction...";
      case "verifying":
        return "Verifying payment on blockchain...";
      case "success":
        return "Payment successful! 🎉";
      case "error":
        return error || "Something went wrong";
      default:
        return "";
    }
  };

  const isProcessing = [
    "checking-balance",
    "approving",
    "waiting-approval",
    "paying",
    "waiting-payment",
    "verifying",
  ].includes(step);

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
            Secure payment with escrow protection
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tool Info */}
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4">
            <h3 className="font-semibold text-lg mb-1">{toolDisplayName}</h3>
            {description && (
              <p className="text-sm text-muted-foreground mb-3">
                {description}
              </p>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">${price.toFixed(2)}</span>
              <span className="text-muted-foreground">USDC</span>
            </div>
          </div>

          {/* Balance Info */}
          {authenticated && (
            <div className="text-sm text-muted-foreground">
              Your balance: {parseFloat(balance).toFixed(2)} USDC
            </div>
          )}

          {/* Status Message */}
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

          {/* Transaction Hash */}
          {txHash && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              View transaction on Arbiscan
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          {/* Escrow Protection Badge */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-xl">🛡️</span>
            <div>
              <div className="font-medium text-foreground">
                Escrow Protection
              </div>
              <div className="text-xs">
                Funds held securely until service delivered
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
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
              "Pay with Wallet"
            ) : (
              "Connect Wallet"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

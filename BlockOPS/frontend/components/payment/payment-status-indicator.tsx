"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle,
  Clock,
  XCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PaymentStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "refunded"
  | "failed"
  | "expired";

interface PaymentStatusIndicatorProps {
  paymentHash: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
  showDetails?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  onStatusChange?: (status: PaymentStatus) => void;
}

interface PaymentData {
  status: PaymentStatus;
  amount: number;
  tokenSymbol: string;
  createdAt: string;
  expiresAt?: string;
  executedAt?: string;
  refundedAt?: string;
}

const EXPLORER_URL = "https://sepolia.arbiscan.io";

export default function PaymentStatusIndicator({
  paymentHash,
  autoRefresh = true,
  refreshInterval = 10000,
  showDetails = true,
  size = "md",
  className = "",
  onStatusChange,
}: PaymentStatusIndicatorProps) {
  const [payment, setPayment] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPaymentStatus = async () => {
    try {
      const response = await fetch(
        `/api/payments/verify?paymentHash=${paymentHash}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch payment status");
      }

      const data = await response.json();
      setPayment(data.payment);
      setError(null);

      if (onStatusChange && data.payment?.status) {
        onStatusChange(data.payment.status);
      }
    } catch (err: any) {
      console.error("Error fetching payment status:", err);
      setError(err.message || "Failed to load status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaymentStatus();
  }, [paymentHash]);

  // Auto-refresh for pending/confirmed statuses
  useEffect(() => {
    if (!autoRefresh || !payment) return;

    // Stop refreshing if payment is in final state
    if (["executed", "refunded", "failed", "expired"].includes(payment.status)) {
      return;
    }

    const interval = setInterval(fetchPaymentStatus, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, payment?.status, refreshInterval]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <span className="text-sm text-muted-foreground">
          Loading payment status...
        </span>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className={`flex items-center gap-2 text-red-500 ${className}`}>
        <XCircle className="h-4 w-4" />
        <span className="text-sm">{error || "Unknown error"}</span>
      </div>
    );
  }

  const getStatusConfig = (status: PaymentStatus) => {
    switch (status) {
      case "pending":
        return {
          icon: Clock,
          label: "Pending",
          color: "text-yellow-600 dark:text-yellow-400",
          bgColor: "bg-yellow-100 dark:bg-yellow-900/20",
          description: "Waiting for blockchain confirmation",
        };
      case "confirmed":
        return {
          icon: CheckCircle,
          label: "Confirmed",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/20",
          description: "Payment confirmed, ready for execution",
        };
      case "executed":
        return {
          icon: CheckCircle,
          label: "Executed",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/20",
          description: "Service delivered successfully",
        };
      case "refunded":
        return {
          icon: RefreshCw,
          label: "Refunded",
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/20",
          description: "Payment refunded to your wallet",
        };
      case "failed":
        return {
          icon: XCircle,
          label: "Failed",
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-100 dark:bg-red-900/20",
          description: "Transaction failed",
        };
      case "expired":
        return {
          icon: XCircle,
          label: "Expired",
          color: "text-gray-600 dark:text-gray-400",
          bgColor: "bg-gray-100 dark:bg-gray-900/20",
          description: "Payment expired",
        };
      default:
        return {
          icon: Clock,
          label: "Unknown",
          color: "text-gray-600",
          bgColor: "bg-gray-100",
          description: "Status unknown",
        };
    }
  };

  const statusConfig = getStatusConfig(payment.status);
  const Icon = statusConfig.icon;

  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-3 py-1.5",
    lg: "text-base px-4 py-2",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const indicator = (
    <div
      className={`inline-flex items-center gap-2 rounded-full font-medium ${statusConfig.bgColor} ${statusConfig.color} ${sizeClasses[size]} ${className}`}
    >
      <Icon className={iconSizes[size]} />
      <span>{statusConfig.label}</span>
      {["pending", "confirmed"].includes(payment.status) && (
        <Loader2 className={`${iconSizes[size]} animate-spin ml-1`} />
      )}
    </div>
  );

  if (!showDetails) {
    return indicator;
  }

  return (
    <TooltipProvider>
      <div className={`space-y-2 ${className}`}>
        <Tooltip>
          <TooltipTrigger asChild>{indicator}</TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-2 text-xs">
              <p className="font-medium">{statusConfig.description}</p>
              <div className="space-y-1 text-muted-foreground">
                <div>
                  Amount: {payment.amount} {payment.tokenSymbol}
                </div>
                <div>
                  Created:{" "}
                  {new Date(payment.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {payment.executedAt && (
                  <div>
                    Executed:{" "}
                    {new Date(payment.executedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
                {payment.refundedAt && (
                  <div>
                    Refunded:{" "}
                    {new Date(payment.refundedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Transaction Link */}
        <a
          href={`${EXPLORER_URL}/tx/${paymentHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          View on Arbiscan
          <ExternalLink className="h-3 w-3" />
        </a>

        {/* Manual Refresh Button */}
        {!autoRefresh && (
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchPaymentStatus}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

// Compact version for lists
export function PaymentStatusBadge({
  status,
  size = "sm",
}: {
  status: PaymentStatus;
  size?: "sm" | "md";
}) {
  const getStatusConfig = (status: PaymentStatus) => {
    switch (status) {
      case "pending":
        return {
          icon: Clock,
          label: "Pending",
          color: "text-yellow-700 dark:text-yellow-300",
          bgColor: "bg-yellow-100 dark:bg-yellow-900/20",
        };
      case "confirmed":
        return {
          icon: CheckCircle,
          label: "Confirmed",
          color: "text-blue-700 dark:text-blue-300",
          bgColor: "bg-blue-100 dark:bg-blue-900/20",
        };
      case "executed":
        return {
          icon: CheckCircle,
          label: "Executed",
          color: "text-green-700 dark:text-green-300",
          bgColor: "bg-green-100 dark:bg-green-900/20",
        };
      case "refunded":
        return {
          icon: RefreshCw,
          label: "Refunded",
          color: "text-purple-700 dark:text-purple-300",
          bgColor: "bg-purple-100 dark:bg-purple-900/20",
        };
      case "failed":
        return {
          icon: XCircle,
          label: "Failed",
          color: "text-red-700 dark:text-red-300",
          bgColor: "bg-red-100 dark:bg-red-900/20",
        };
      case "expired":
        return {
          icon: XCircle,
          label: "Expired",
          color: "text-gray-700 dark:text-gray-300",
          bgColor: "bg-gray-100 dark:bg-gray-900/20",
        };
      default:
        return {
          icon: Clock,
          label: "Unknown",
          color: "text-gray-700",
          bgColor: "bg-gray-100",
        };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;

  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${config.bgColor} ${config.color} ${sizeClasses}`}
    >
      <Icon className={iconSize} />
      {config.label}
    </span>
  );
}

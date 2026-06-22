"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ExternalLink, 
  Loader2,
  RefreshCw 
} from "lucide-react"
import { cn } from "@/lib/utils"

interface PaymentStatusIndicatorProps {
  paymentHash?: string
  paymentId?: string
  status?: PaymentStatus
  onRefresh?: () => void
  showDetails?: boolean
  variant?: "badge" | "full"
  className?: string
}

type PaymentStatus = "pending" | "confirmed" | "executed" | "refunded" | "failed" | "expired"

interface PaymentDetails {
  payment_hash: string
  payment_id: string
  status: PaymentStatus
  amount: string
  token_address: string
  tool_name: string
  created_at: string
  executed_at?: string
  refunded_at?: string
  error_message?: string
}

export function PaymentStatusIndicator({
  paymentHash,
  paymentId,
  status: initialStatus,
  onRefresh,
  showDetails = true,
  variant = "badge",
  className,
}: PaymentStatusIndicatorProps) {
  const [status, setStatus] = useState<PaymentStatus>(initialStatus || "pending")
  const [details, setDetails] = useState<PaymentDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>("")

  useEffect(() => {
    if ((paymentHash || paymentId) && showDetails) {
      fetchPaymentStatus()
    }
  }, [paymentHash, paymentId])

  const fetchPaymentStatus = async () => {
    if (!paymentHash && !paymentId) return

    setLoading(true)
    setError("")

    try {
      const query = paymentHash ? `paymentHash=${paymentHash}` : `paymentId=${paymentId}`
      const response = await fetch(`/api/payments/verify?${query}`)

      if (!response.ok) {
        throw new Error("Failed to fetch payment status")
      }

      const data = await response.json()
      if (data.payment) {
        setDetails(data.payment)
        setStatus(data.payment.status)
      }
    } catch (error: any) {
      console.error("Error fetching payment status:", error)
      setError(error.message || "Failed to load payment status")
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh()
    } else {
      fetchPaymentStatus()
    }
  }

  const getStatusConfig = (currentStatus: PaymentStatus) => {
    switch (currentStatus) {
      case "pending":
        return {
          icon: Clock,
          label: "Pending",
          variant: "secondary" as const,
          color: "text-yellow-500",
          description: "Payment transaction is being processed on the blockchain",
        }
      case "confirmed":
        return {
          icon: CheckCircle2,
          label: "Confirmed",
          variant: "default" as const,
          color: "text-blue-500",
          description: "Payment confirmed, waiting for service execution",
        }
      case "executed":
        return {
          icon: CheckCircle2,
          label: "Completed",
          variant: "default" as const,
          color: "text-green-500",
          description: "Payment completed and funds released to treasury",
        }
      case "refunded":
        return {
          icon: AlertCircle,
          label: "Refunded",
          variant: "outline" as const,
          color: "text-orange-500",
          description: "Payment refunded due to service failure",
        }
      case "failed":
        return {
          icon: XCircle,
          label: "Failed",
          variant: "destructive" as const,
          color: "text-red-500",
          description: "Payment transaction failed",
        }
      case "expired":
        return {
          icon: XCircle,
          label: "Expired",
          variant: "outline" as const,
          color: "text-gray-500",
          description: "Payment authorization expired",
        }
      default:
        return {
          icon: AlertCircle,
          label: "Unknown",
          variant: "outline" as const,
          color: "text-gray-500",
          description: "Status unknown",
        }
    }
  }

  const statusConfig = getStatusConfig(status)
  const Icon = statusConfig.icon

  // Badge variant - minimal display
  if (variant === "badge") {
    return (
      <Badge variant={statusConfig.variant} className={cn("gap-1", className)}>
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Icon className={cn("h-3 w-3", statusConfig.color)} />
        )}
        {statusConfig.label}
      </Badge>
    )
  }

  // Full variant - detailed display
  return (
    <Alert className={cn("relative", className)}>
      <div className="flex items-start gap-3">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin mt-0.5" />
        ) : (
          <Icon className={cn("h-5 w-5 mt-0.5", statusConfig.color)} />
        )}
        
        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="font-semibold text-sm">{statusConfig.label}</h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                {error || statusConfig.description}
              </p>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>

          {showDetails && details && (
            <div className="space-y-1.5 text-xs text-muted-foreground pt-2 border-t">
              {details.tool_name && (
                <div className="flex justify-between">
                  <span>Tool:</span>
                  <span className="font-mono">{details.tool_name}</span>
                </div>
              )}
              {details.amount && (
                <div className="flex justify-between">
                  <span>Amount:</span>
                  <span className="font-mono">{details.amount} USDC</span>
                </div>
              )}
              {details.created_at && (
                <div className="flex justify-between">
                  <span>Created:</span>
                  <span>{new Date(details.created_at).toLocaleString()}</span>
                </div>
              )}
              {details.executed_at && (
                <div className="flex justify-between">
                  <span>Executed:</span>
                  <span>{new Date(details.executed_at).toLocaleString()}</span>
                </div>
              )}
              {details.refunded_at && (
                <div className="flex justify-between">
                  <span>Refunded:</span>
                  <span>{new Date(details.refunded_at).toLocaleString()}</span>
                </div>
              )}
              {details.error_message && (
                <div className="pt-1">
                  <span className="text-red-500">Error: {details.error_message}</span>
                </div>
              )}
            </div>
          )}

          {(paymentHash || details?.payment_hash) && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Transaction:</span>
              <a
                href={`https://sepolia.arbiscan.io/tx/${paymentHash || details?.payment_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline font-mono"
              >
                {(paymentHash || details?.payment_hash || "").slice(0, 10)}...
                {(paymentHash || details?.payment_hash || "").slice(-8)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </Alert>
  )
}

/**
 * Simple inline status with icon only
 */
export function PaymentStatusIcon({ status }: { status: PaymentStatus }) {
  const getIcon = () => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
      case "confirmed":
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />
      case "executed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case "refunded":
        return <AlertCircle className="h-4 w-4 text-orange-500" />
      case "failed":
      case "expired":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />
    }
  }

  return getIcon()
}

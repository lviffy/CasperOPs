"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Sparkles, Zap, AlertCircle } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { toast } from "@/components/ui/use-toast"

interface AIQuotaBadgeProps {
  variant?: "inline" | "banner"
  onUpgradeClick?: () => void
  showUpgradeButton?: boolean
}

interface QuotaStatus {
  canGenerate: boolean
  freeRemaining: number
  needsPayment: boolean
  freeLimit?: number
  usedToday?: number
}

export function AIQuotaBadge({ 
  variant = "inline", 
  onUpgradeClick,
  showUpgradeButton = true 
}: AIQuotaBadgeProps) {
  const { user, authenticated } = useAuth()
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>("")

  useEffect(() => {
    if (authenticated && user?.id) {
      checkQuota()
    } else {
      setLoading(false)
    }
  }, [authenticated, user])

  const checkQuota = async () => {
    if (!user?.id) return

    setLoading(true)
    setError("")

    try {
      const response = await fetch(`/api/payments/ai-quota?userId=${user.id}`)
      
      if (!response.ok) {
        throw new Error("Failed to check quota")
      }

      const data = await response.json()
      setQuota(data)
    } catch (error: any) {
      console.error("Error checking AI quota:", error)
      setError(error.message || "Failed to load quota")
    } finally {
      setLoading(false)
    }
  }

  const handleUpgrade = () => {
    if (onUpgradeClick) {
      onUpgradeClick()
    } else {
      toast({
        title: "Upgrade to Paid",
        description: "Payment modal will open when you generate your next workflow.",
      })
    }
  }

  if (!authenticated || loading) {
    return null
  }

  if (error) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Error loading quota
      </Badge>
    )
  }

  if (!quota) {
    return null
  }

  // Inline variant - small badge
  if (variant === "inline") {
    const isLow = quota.freeRemaining <= 1 && quota.freeRemaining > 0
    const isExhausted = quota.freeRemaining === 0

    return (
      <div className="flex items-center gap-2">
        <Badge 
          variant={isExhausted ? "destructive" : isLow ? "default" : "secondary"}
          className="gap-1"
        >
          <Sparkles className="h-3 w-3" />
          {quota.freeRemaining}/{quota.freeLimit || 3} Free AI Generations
        </Badge>
        {isExhausted && showUpgradeButton && (
          <Button
            size="sm"
            variant="default"
            onClick={handleUpgrade}
            className="h-6 text-xs"
          >
            <Zap className="mr-1 h-3 w-3" />
            Upgrade
          </Button>
        )}
      </div>
    )
  }

  // Banner variant - full width alert
  const isLow = quota.freeRemaining <= 1 && quota.freeRemaining > 0
  const isExhausted = quota.freeRemaining === 0

  if (isExhausted) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <div>
            <strong>Free AI generations exhausted</strong>
            <p className="text-sm mt-1">
              You've used all {quota.freeLimit || 3} free AI workflow generations for today. 
              Upgrade to paid to continue generating workflows ($0.25 per generation).
            </p>
          </div>
          {showUpgradeButton && (
            <Button
              size="sm"
              variant="default"
              onClick={handleUpgrade}
              className="ml-4 shrink-0"
            >
              <Zap className="mr-1 h-4 w-4" />
              Pay $0.25
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (isLow) {
    return (
      <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
        <AlertCircle className="h-4 w-4 text-yellow-500" />
        <AlertDescription>
          <strong>Running low on free generations</strong>
          <p className="text-sm mt-1">
            You have <strong>{quota.freeRemaining}</strong> free AI workflow generation
            {quota.freeRemaining === 1 ? "" : "s"} remaining today. 
            After that, it's $0.25 per generation.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  // Show nothing if user has plenty of quota remaining (banner mode)
  return null
}

/**
 * Compact version for use in headers/navbars
 */
export function AIQuotaBadgeCompact() {
  const { user, authenticated } = useAuth()
  const [quota, setQuota] = useState<QuotaStatus | null>(null)

  useEffect(() => {
    if (authenticated && user?.id) {
      checkQuota()
    }
  }, [authenticated, user])

  const checkQuota = async () => {
    if (!user?.id) return

    try {
      const response = await fetch(`/api/payments/ai-quota?userId=${user.id}`)
      if (response.ok) {
        const data = await response.json()
        setQuota(data)
      }
    } catch (error) {
      console.error("Error checking AI quota:", error)
    }
  }

  if (!authenticated || !quota) {
    return null
  }

  const isExhausted = quota.freeRemaining === 0
  const isLow = quota.freeRemaining <= 1 && quota.freeRemaining > 0

  return (
    <Badge 
      variant={isExhausted ? "destructive" : isLow ? "default" : "outline"}
      className="gap-1"
    >
      <Sparkles className="h-3 w-3" />
      {quota.freeRemaining}/{quota.freeLimit || 3}
    </Badge>
  )
}

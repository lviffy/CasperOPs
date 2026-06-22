"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { DollarSign, Sparkles, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface ToolPricingBadgeProps {
  toolName: string
  onClick?: () => void
  showTooltip?: boolean
  className?: string
  variant?: "default" | "compact"
}

interface PricingInfo {
  price: string
  isFree: boolean
  displayName: string
  description: string
  category?: string
}

export function ToolPricingBadge({ 
  toolName, 
  onClick,
  showTooltip = true,
  className,
  variant = "default"
}: ToolPricingBadgeProps) {
  const [pricing, setPricing] = useState<PricingInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPricing()
  }, [toolName])

  const fetchPricing = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/payments/pricing?toolName=${encodeURIComponent(toolName)}`)
      
      if (response.ok) {
        const data = await response.json()
        setPricing(data)
      } else {
        // Default to paid if pricing not found
        setPricing({
          price: "0.25",
          isFree: false,
          displayName: toolName,
          description: "Premium tool",
        })
      }
    } catch (error) {
      console.error("Error fetching pricing:", error)
      setPricing({
        price: "0.25",
        isFree: false,
        displayName: toolName,
        description: "Premium tool",
      })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Badge variant="outline" className={cn("gap-1 animate-pulse", className)}>
        <div className="h-3 w-12 bg-muted rounded" />
      </Badge>
    )
  }

  if (!pricing) {
    return null
  }

  const badgeContent = pricing.isFree ? (
    <Badge 
      variant="secondary" 
      className={cn("gap-1 cursor-default", className)}
    >
      <Sparkles className="h-3 w-3" />
      {variant === "compact" ? "FREE" : "Free"}
    </Badge>
  ) : (
    <Badge 
      variant="default" 
      className={cn("gap-1 bg-linear-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600", onClick && "cursor-pointer", className)}
      onClick={onClick}
    >
      <DollarSign className="h-3 w-3" />
      {variant === "compact" ? pricing.price : `${pricing.price} USDC`}
    </Badge>
  )

  if (!showTooltip || pricing.isFree) {
    return badgeContent
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        {badgeContent}
      </HoverCardTrigger>
      <HoverCardContent className="w-80" side="top">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">{pricing.displayName}</h4>
              {pricing.category && (
                <Badge variant="outline" className="mt-1 text-xs">
                  {pricing.category}
                </Badge>
              )}
            </div>
            <Badge variant="default" className="shrink-0">
              ${pricing.price} USDC
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground">
            {pricing.description}
          </p>

          <div className="border-t pt-2 space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span>Payment held in escrow until execution</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span>Automatic refund if operation fails</span>
            </div>
          </div>

          {onClick && (
            <div className="text-xs text-center pt-2 border-t">
              <span className="text-muted-foreground">Click badge to pay and use this tool</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * Simple pricing indicator without interactive features
 */
export function ToolPriceIndicator({ toolName }: { toolName: string }) {
  const [pricing, setPricing] = useState<PricingInfo | null>(null)

  useEffect(() => {
    fetch(`/api/payments/pricing?toolName=${encodeURIComponent(toolName)}`)
      .then(res => res.json())
      .then(data => setPricing(data))
      .catch(() => {})
  }, [toolName])

  if (!pricing) return null

  return (
    <span className="text-xs text-muted-foreground">
      {pricing.isFree ? "Free" : `$${pricing.price}`}
    </span>
  )
}

"use client";

import { useState, useEffect } from "react";
import { DollarSign, Sparkles, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ToolPricingBadgeProps {
  toolName: string;
  showTooltip?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  className?: string;
}

interface PricingData {
  price: number;
  isFree: boolean;
  displayName: string;
  description?: string;
  category?: string;
}

export default function ToolPricingBadge({
  toolName,
  showTooltip = true,
  size = "md",
  onClick,
  className = "",
}: ToolPricingBadgeProps) {
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const response = await fetch(
          `/api/payments/pricing?toolName=${encodeURIComponent(toolName)}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch pricing");
        }

        const data = await response.json();
        setPricing(data);
      } catch (err) {
        console.error("Error fetching pricing:", err);
        // Default to showing as paid if fetch fails
        setPricing({
          price: 0,
          isFree: false,
          displayName: toolName,
          description: "Pricing unavailable",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPricing();
  }, [toolName]);

  if (loading) {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 ${className}`}
      >
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!pricing) {
    return null;
  }

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  const badge = (
    <div
      className={`inline-flex items-center gap-1 rounded-full font-medium transition-all ${
        sizeClasses[size]
      } ${
        pricing.isFree
          ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300"
          : "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
      } ${onClick ? "cursor-pointer hover:scale-105" : ""} ${className}`}
      onClick={onClick}
    >
      {pricing.isFree ? (
        <>
          <Sparkles className={iconSizes[size]} />
          <span>FREE</span>
        </>
      ) : (
        <>
          <DollarSign className={iconSizes[size]} />
          <span>${pricing.price.toFixed(2)}</span>
        </>
      )}
    </div>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <div className="font-semibold">{pricing.displayName}</div>
            {pricing.description && (
              <p className="text-xs text-muted-foreground">
                {pricing.description}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs pt-1 border-t">
              {pricing.isFree ? (
                <span className="text-green-600 dark:text-green-400 font-medium">
                  ✨ No payment required
                </span>
              ) : (
                <>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    💳 ${pricing.price.toFixed(2)} USDC
                  </span>
                  <span className="text-muted-foreground">per use</span>
                </>
              )}
            </div>
            {!pricing.isFree && (
              <div className="flex items-start gap-1 text-xs text-muted-foreground pt-1">
                <Info className="h-3 w-3 shrink-0 mt-0.5" />
                <span>Protected by escrow - automatic refund if failed</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Compact version for inline display
export function ToolPricingInline({
  toolName,
  className = "",
}: {
  toolName: string;
  className?: string;
}) {
  const [pricing, setPricing] = useState<PricingData | null>(null);

  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const response = await fetch(
          `/api/payments/pricing?toolName=${encodeURIComponent(toolName)}`
        );
        if (response.ok) {
          const data = await response.json();
          setPricing(data);
        }
      } catch (err) {
        console.error("Error fetching pricing:", err);
      }
    };

    fetchPricing();
  }, [toolName]);

  if (!pricing) {
    return null;
  }

  return (
    <span className={`text-xs text-muted-foreground ${className}`}>
      {pricing.isFree ? (
        <span className="text-green-600 dark:text-green-400">FREE</span>
      ) : (
        <span className="text-blue-600 dark:text-blue-400">
          ${pricing.price.toFixed(2)}
        </span>
      )}
    </span>
  );
}

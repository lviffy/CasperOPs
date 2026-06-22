"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Sparkles, Zap, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AIQuotaDisplayProps {
  onUpgrade?: () => void;
  className?: string;
}

interface QuotaData {
  canGenerate: boolean;
  freeRemaining: number;
  needsPayment: boolean;
  freeLimit: number;
  freeUsed: number;
}

export default function AIQuotaDisplay({
  onUpgrade,
  className = "",
}: AIQuotaDisplayProps) {
  const { user, authenticated } = usePrivy();
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuota = async () => {
    if (!authenticated || !user?.id) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/payments/ai-quota?userId=${user.id}`);

      if (!response.ok) {
        throw new Error("Failed to fetch quota");
      }

      const data = await response.json();
      setQuota(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching quota:", err);
      setError("Failed to load quota");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, [authenticated, user?.id]);

  // Refresh quota every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchQuota, 30000);
    return () => clearInterval(interval);
  }, [authenticated, user?.id]);

  if (!authenticated) {
    return null;
  }

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error || !quota) {
    return (
      <div className={`flex items-center gap-2 text-red-500 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">{error || "Unknown error"}</span>
      </div>
    );
  }

  const percentage = (quota.freeUsed / quota.freeLimit) * 100;
  const remaining = quota.freeRemaining;

  return (
    <TooltipProvider>
      <div className={`space-y-2 ${className}`}>
        {/* Quota Badge */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                remaining === 0
                  ? "bg-red-100 dark:bg-red-900/20 text-red-900 dark:text-red-200"
                  : remaining <= 1
                  ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200"
                  : "bg-blue-100 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200"
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span>
                {remaining} of {quota.freeLimit} free AI generations left today
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Daily quota resets at midnight UTC
              <br />
              Used: {quota.freeUsed} / {quota.freeLimit}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              percentage >= 100
                ? "bg-red-500"
                : percentage >= 66
                ? "bg-yellow-500"
                : "bg-blue-500"
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>

        {/* Warning Message */}
        {remaining === 0 && (
          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                Daily quota reached
              </p>
              <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-1">
                You've used all free AI generations today. Additional generations
                cost $0.25 USDC each.
              </p>
              {onUpgrade && (
                <Button
                  size="sm"
                  variant="default"
                  className="mt-2"
                  onClick={onUpgrade}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  Continue with Payment
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Low Quota Warning */}
        {remaining === 1 && (
          <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 dark:text-blue-300">
              Last free generation! After this, AI generations will cost $0.25
              USDC each.
            </p>
          </div>
        )}

        {/* Info Message - All Good */}
        {remaining > 1 && (
          <p className="text-xs text-muted-foreground">
            ✨ Enjoying free AI workflow generation! Resets daily.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

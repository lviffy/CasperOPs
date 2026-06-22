"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Sparkles } from "lucide-react";

interface AIQuotaCompactProps {
  className?: string;
}

interface QuotaData {
  freeRemaining: number;
  freeLimit: number;
}

export default function AIQuotaCompact({ className = "" }: AIQuotaCompactProps) {
  const { user, authenticated } = usePrivy();
  const [quota, setQuota] = useState<QuotaData>({
    freeRemaining: 3,
    freeLimit: 3,
  });

  const fetchQuota = async () => {
    if (!authenticated || !user?.id) return;

    try {
      const response = await fetch(`/api/payments/ai-quota?userId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setQuota(data);
      }
    } catch (err) {
      console.error("Error fetching quota:", err);
    }
  };

  useEffect(() => {
    fetchQuota();
    const interval = setInterval(fetchQuota, 30000);
    return () => clearInterval(interval);
  }, [authenticated, user?.id]);

  if (!authenticated) return null;

  const percentage = (quota.freeRemaining / quota.freeLimit) * 100;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>AI Quota</span>
        </div>
        <span className="font-mono font-medium text-foreground tabular-nums">
          {quota.freeRemaining}/{quota.freeLimit}
        </span>
      </div>
      
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-foreground transition-all duration-300 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";

interface UsePaymentOptions {
  toolName?: string;
  agentId?: string;
}

interface QuotaData {
  canGenerate: boolean;
  freeRemaining: number;
  needsPayment: boolean;
}

interface PricingData {
  price: number;
  isFree: boolean;
  displayName: string;
  description?: string;
}

export function usePayment({ toolName, agentId }: UsePaymentOptions = {}) {
  const { user, authenticated } = usePrivy();
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [hasAgreedToTerms, setHasAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user has agreed to payment terms
  const checkAgreement = useCallback(async () => {
    if (!authenticated || !user?.id) return false;

    try {
      const response = await fetch(
        `/api/payments/agreement?userId=${user.id}&version=v1.0`
      );
      if (response.ok) {
        const data = await response.json();
        setHasAgreedToTerms(data.hasAgreed);
        return data.hasAgreed;
      }
      return false;
    } catch (err) {
      console.error("Error checking agreement:", err);
      return false;
    }
  }, [authenticated, user?.id]);

  // Fetch AI generation quota
  const fetchQuota = useCallback(async () => {
    if (!authenticated || !user?.id) return null;

    try {
      const response = await fetch(`/api/payments/ai-quota?userId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setQuota(data);
        return data;
      }
      return null;
    } catch (err) {
      console.error("Error fetching quota:", err);
      return null;
    }
  }, [authenticated, user?.id]);

  // Fetch tool pricing
  const fetchPricing = useCallback(
    async (tool?: string) => {
      const targetTool = tool || toolName;
      if (!targetTool) return null;

      try {
        const response = await fetch(
          `/api/payments/pricing?toolName=${encodeURIComponent(targetTool)}`
        );
        if (response.ok) {
          const data = await response.json();
          setPricing(data);
          return data;
        }
        return null;
      } catch (err) {
        console.error("Error fetching pricing:", err);
        return null;
      }
    },
    [toolName]
  );

  // Increment AI usage
  const incrementAIUsage = useCallback(
    async (isPaid: boolean = false) => {
      if (!authenticated || !user?.id) return false;

      try {
        const response = await fetch("/api/payments/ai-quota", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            isPaid,
          }),
        });

        if (response.ok) {
          await fetchQuota(); // Refresh quota
          return true;
        }
        return false;
      } catch (err) {
        console.error("Error incrementing usage:", err);
        return false;
      }
    },
    [authenticated, user?.id, fetchQuota]
  );

  // Check if payment is required for a tool
  const requiresPayment = useCallback(
    async (tool?: string): Promise<boolean> => {
      const targetTool = tool || toolName;
      if (!targetTool) return false;

      const pricingData = await fetchPricing(targetTool);
      return pricingData ? !pricingData.isFree : false;
    },
    [toolName, fetchPricing]
  );

  // Check if AI generation needs payment
  const aiGenerationNeedsPayment = useCallback(async (): Promise<boolean> => {
    const quotaData = await fetchQuota();
    return quotaData ? quotaData.needsPayment : false;
  }, [fetchQuota]);

  // Execute payment flow
  const executePayment = useCallback(
    async (paymentHash: string): Promise<{ executionToken?: string; paymentId?: string } | null> => {
      if (!authenticated || !user?.id) {
        toast.error("User not authenticated");
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentHash,
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
        toast.success("Payment verified!");
        return data;
      } catch (err: any) {
        console.error("Payment error:", err);
        setError(err.message);
        toast.error(err.message || "Payment failed");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [authenticated, user?.id, agentId, toolName]
  );

  // Complete payment execution (release escrow)
  const completePayment = useCallback(
    async (paymentId: string, executionToken: string): Promise<boolean> => {
      try {
        const response = await fetch("/api/payments/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId,
            executionToken,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to complete payment");
        }

        toast.success("Payment completed successfully!");
        return true;
      } catch (err: any) {
        console.error("Error completing payment:", err);
        toast.error(err.message || "Failed to complete payment");
        return false;
      }
    },
    []
  );

  // Request refund
  const requestRefund = useCallback(
    async (paymentId: string, reason: string): Promise<boolean> => {
      try {
        const response = await fetch("/api/payments/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId,
            reason,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to request refund");
        }

        toast.success("Refund processed successfully!");
        return true;
      } catch (err: any) {
        console.error("Error requesting refund:", err);
        toast.error(err.message || "Failed to process refund");
        return false;
      }
    },
    []
  );

  // Initialize data on mount
  useEffect(() => {
    if (authenticated) {
      checkAgreement();
      fetchQuota();
      if (toolName) {
        fetchPricing(toolName);
      }
    }
  }, [authenticated, toolName, checkAgreement, fetchQuota, fetchPricing]);

  return {
    // State
    quota,
    pricing,
    hasAgreedToTerms,
    loading,
    error,
    authenticated,
    user,

    // Methods
    checkAgreement,
    fetchQuota,
    fetchPricing,
    incrementAIUsage,
    requiresPayment,
    aiGenerationNeedsPayment,
    executePayment,
    completePayment,
    requestRefund,
  };
}

// Hook for AI generation with payment flow
export function useAIGeneration() {
  const payment = usePayment();

  const generateWithPayment = useCallback(
    async (onGenerate: () => Promise<void>) => {
      // Check quota first
      const needsPayment = await payment.aiGenerationNeedsPayment();

      if (!needsPayment) {
        // Use free generation
        await payment.incrementAIUsage(false);
        await onGenerate();
        return { success: true, usedFree: true };
      }

      // Payment required
      return {
        success: false,
        needsPayment: true,
        hasAgreedToTerms: payment.hasAgreedToTerms,
      };
    },
    [payment]
  );

  return {
    ...payment,
    generateWithPayment,
  };
}

// Hook for tool execution with payment flow
export function useToolExecution(toolName: string, agentId?: string) {
  const payment = usePayment({ toolName, agentId });

  const executeWithPayment = useCallback(
    async (
      onExecute: (executionToken: string) => Promise<void>,
      paymentHash?: string
    ) => {
      // Check if tool is free
      const needsPayment = await payment.requiresPayment(toolName);

      if (!needsPayment) {
        // Execute directly without payment
        await onExecute("");
        return { success: true, isFree: true };
      }

      if (!paymentHash) {
        // Payment required but not provided
        return {
          success: false,
          needsPayment: true,
          hasAgreedToTerms: payment.hasAgreedToTerms,
          pricing: payment.pricing,
        };
      }

      // Verify payment and get execution token
      const result = await payment.executePayment(paymentHash);
      if (!result?.executionToken) {
        return { success: false, error: "Payment verification failed" };
      }

      try {
        // Execute tool with token
        await onExecute(result.executionToken);

        // Complete payment (release escrow)
        await payment.completePayment(result.paymentId!, result.executionToken);

        return { success: true, paymentId: result.paymentId };
      } catch (err: any) {
        // Request refund on failure
        if (result.paymentId) {
          await payment.requestRefund(
            result.paymentId,
            err.message || "Tool execution failed"
          );
        }
        return { success: false, error: err.message };
      }
    },
    [payment, toolName]
  );

  return {
    ...payment,
    executeWithPayment,
  };
}

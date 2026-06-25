"use client";

/**
 * Pricing page (Phase 29 + Phase 31).
 *
 * Three-tier comparison (free / pro / enterprise) with CTAs that
 * sign the user in via CSPR.click (existing component) and route
 * them through the Stripe Checkout flow.
 *
 * Phase 31: the "Upgrade to Pro" button now calls
 * `POST /billing/checkout` which creates a Stripe Checkout Session
 * and returns the redirect URL. The mock mode (when
 * `STRIPE_DISABLED=1`) returns a URL with `?mock=1` so the frontend
 * can develop without a real Stripe account.
 */

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "/ month",
    description: "For developers experimenting with the Casper tool surface.",
    rateLimit: "60 requests / minute",
    highlight: false,
    features: [
      "All 22 tools",
      "Free reads: get_balance, fetch_price, get_reputation, lookup_deploy",
      "Community support (Discord)",
    ],
    cta: "Start for free",
    checkoutTier: null,
    externalHref: "/api-keys",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$99",
    cadence: "/ month",
    description: "For teams shipping Casper-powered agents to production.",
    rateLimit: "600 requests / minute",
    highlight: true,
    features: [
      "Everything in Free",
      "10× higher rate limits",
      "x402 payment deploys (sign via CSPR.click)",
      "Priority email support (24 h SLA)",
      "Webhook delivery + retries",
    ],
    cta: "Upgrade to Pro",
    checkoutTier: "pro",
    externalHref: null,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description: "For high-volume platforms + financial institutions.",
    rateLimit: "6,000 requests / minute",
    highlight: false,
    features: [
      "Everything in Pro",
      "100× higher rate limits",
      "Dedicated signer key for treasury flows",
      "Slack Connect + phone support",
      "Custom contract deployment",
      "On-prem MCP server option",
    ],
    cta: "Contact sales",
    checkoutTier: "enterprise",
    externalHref: null,
  },
];

export default function PricingPage() {
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(tier: "pro" | "enterprise") {
    setBusyTier(tier);
    setError(null);
    try {
      const res = await fetch("/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) throw new Error(`/billing/checkout → HTTP ${res.status}`);
      const body = await res.json();
      if (!body.url) throw new Error("No redirect URL returned");
      if (body.enterprise) {
        // Enterprise opens a mailto: link — pop it in a new tab so
        // the user can come back to /pricing after they send the email.
        window.location.href = body.url;
        return;
      }
      window.location.href = body.url;
    } catch (err: any) {
      setError(err.message || "Unknown error");
      setBusyTier(null);
    }
  }

  return (
    <main className="container mx-auto px-4 py-12 max-w-6xl">
      <header className="text-center mb-12">
        <h1 className="text-4xl font-bold">Pricing</h1>
        <p className="text-muted-foreground mt-3 text-lg">
          Pay for what you use. Free for solo devs, Pro for teams,
          Enterprise for platforms.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 mx-auto max-w-md rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => {
          const isFree = tier.id === "free";
          const button = (
            <Button
              className="w-full"
              variant={tier.highlight ? "default" : "outline"}
              disabled={!isFree && busyTier === tier.checkoutTier}
              onClick={() => {
                if (isFree) return;
                startCheckout(tier.checkoutTier as "pro" | "enterprise");
              }}
            >
              {tier.cta}
            </Button>
          );
          return (
            <Card
              key={tier.id}
              className={
                tier.highlight
                  ? "border-primary shadow-lg ring-2 ring-primary/20"
                  : undefined
              }
              aria-label={`${tier.name} tier`}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {tier.name}
                  {tier.highlight && (
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded-full">
                      Most popular
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground">{tier.cadence}</span>
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  <strong>{tier.rateLimit}</strong>
                </div>
                <ul className="space-y-2 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span aria-hidden="true" className="text-primary">
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {isFree ? (
                  <Link href={tier.externalHref!} className="w-full">
                    {button}
                  </Link>
                ) : (
                  <div className="w-full">{button}</div>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          All plans include the full 22-tool Casper surface.
          Usage-based billing (per CSPR.transfer) is metered separately
          via the x402 protocol.
        </p>
        <p className="mt-2">
          Questions?{" "}
          <Link href="mailto:sales@casperops.example" className="underline">
            sales@casperops.example
          </Link>
        </p>
      </footer>
    </main>
  );
}
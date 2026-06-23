"use client";

/**
 * Pricing page (Phase 29).
 *
 * Three-tier comparison (free / pro / enterprise) with a CTA that
 * signs the user in via CSPR.click (existing component) and routes
 * them to /api-keys to mint a key for the chosen tier.
 *
 * Stripe Checkout integration is a Phase 29 follow-up — for now the
 * "Upgrade" button bumps the user to "pro" via an authenticated POST
 * that flips the tier in Supabase. Production will swap this for a
 * Stripe Checkout session + webhook handler.
 */

import Link from "next/link";
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
    href: "/api-keys",
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
    href: "/api-keys?upgrade=pro",
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
    href: "mailto:sales@blockops.example",
  },
];

export default function PricingPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-6xl">
      <header className="text-center mb-12">
        <h1 className="text-4xl font-bold">Pricing</h1>
        <p className="text-muted-foreground mt-3 text-lg">
          Pay for what you use. Free for solo devs, Pro for teams,
          Enterprise for platforms.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
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
              <Link href={tier.href} className="w-full">
                <Button
                  className="w-full"
                  variant={tier.highlight ? "default" : "outline"}
                >
                  {tier.cta}
                </Button>
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>

      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          All plans include the full 22-tool Casper surface.
          Usage-based billing (per CSPR.transfer) is metered separately
          via the x402 protocol.
        </p>
        <p className="mt-2">
          Questions?{" "}
          <Link href="mailto:sales@blockops.example" className="underline">
            sales@blockops.example
          </Link>
        </p>
      </footer>
    </main>
  );
}
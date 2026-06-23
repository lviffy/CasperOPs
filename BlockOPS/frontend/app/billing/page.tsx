"use client";

/**
 * Billing page (Phase 31).
 *
 * Surfaces the current Stripe subscription state + a "Cancel
 * subscription" button. The page is intentionally thin — the
 * authoritative state lives in the backend's `/billing/me` and
 * `/billing/invoices` endpoints; we just render the JSON.
 *
 * Mock mode: when `STRIPE_DISABLED=1` is set on the backend the
 * `/billing/checkout` endpoint returns a `mock=1` URL. The
 * "Upgrade to Pro" button then opens a stub URL with the mock flag
 * so the developer can iterate on the UI without a real Stripe
 * account.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type BillingInfo = {
  ok: boolean;
  tier: "free" | "pro" | "enterprise" | "past_due";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  userId: string;
  keyId: string;
};

type Invoice = {
  id: string;
  number: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
};

export default function BillingPage() {
  const [me, setMe] = useState<BillingInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [meRes, invRes] = await Promise.all([
        fetch("/billing/me", { credentials: "include" }),
        fetch("/billing/invoices", { credentials: "include" }),
      ]);
      if (!meRes.ok) throw new Error(`/billing/me → HTTP ${meRes.status}`);
      if (!invRes.ok) throw new Error(`/billing/invoices → HTTP ${invRes.status}`);
      const meBody = await meRes.json();
      const invBody = await invRes.json();
      setMe(meBody);
      setInvoices(invBody.invoices || []);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function startCheckout(tier: "pro" | "enterprise") {
    setBusy(true);
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
      if (body.url) {
        window.location.href = body.url;
      } else {
        throw new Error("no redirect URL returned");
      }
    } catch (err: any) {
      setError(err.message || "Unknown error");
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel your Pro subscription? You'll keep access until the end of the billing period.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stripeSubscriptionId: me?.stripeSubscriptionId }),
      });
      if (!res.ok) throw new Error(`/billing/cancel → HTTP ${res.status}`);
      await load();
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function fmtAmount(cents: number, currency: string) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Billing</h1>
        <Link href="/api-keys" className="text-sm text-muted-foreground underline">
          ← Back to API keys
        </Link>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {me === null ? (
        <Skeleton className="h-32 w-full mb-6" />
      ) : (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>
              {me.tier === "free" && "Free tier — 60 requests / minute."}
              {me.tier === "pro" && "Pro tier — 600 requests / minute + priority support."}
              {me.tier === "enterprise" && "Enterprise — custom limits + dedicated signer."}
              {me.tier === "past_due" && (
                <span className="text-destructive">
                  Payment past due — update your card to restore Pro access.
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono">{me.userId}</dd>
              <dt className="text-muted-foreground">API key</dt>
              <dd className="font-mono">...{me.keyId.slice(-8)}</dd>
              {me.stripeCustomerId && (
                <>
                  <dt className="text-muted-foreground">Stripe customer</dt>
                  <dd className="font-mono">{me.stripeCustomerId}</dd>
                </>
              )}
              {me.stripeSubscriptionId && (
                <>
                  <dt className="text-muted-foreground">Stripe subscription</dt>
                  <dd className="font-mono">{me.stripeSubscriptionId}</dd>
                </>
              )}
            </dl>
          </CardContent>
          <CardFooter className="gap-3">
            {me.tier === "free" && (
              <>
                <Button onClick={() => startCheckout("pro")} disabled={busy}>
                  Upgrade to Pro — $99/mo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => startCheckout("enterprise")}
                  disabled={busy}
                >
                  Talk to sales (Enterprise)
                </Button>
              </>
            )}
            {me.tier === "pro" && (
              <Button variant="outline" onClick={cancel} disabled={busy}>
                Cancel subscription
              </Button>
            )}
            {me.tier === "past_due" && (
              <Button onClick={() => startCheckout("pro")} disabled={busy}>
                Update card
              </Button>
            )}
          </CardFooter>
        </Card>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-4">Invoices</h2>
        {invoices === null ? (
          <Skeleton className="h-16 w-full" />
        ) : invoices.length === 0 ? (
          <p className="text-muted-foreground text-sm">No invoices yet.</p>
        ) : (
          <ul className="space-y-3">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Card>
                  <CardContent className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">
                        {inv.number || inv.id}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {fmtAmount(inv.amountPaid, inv.currency)} · {inv.status} ·{" "}
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary underline"
                        >
                          View
                        </a>
                      )}
                      {inv.pdfUrl && (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary underline"
                        >
                          PDF
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
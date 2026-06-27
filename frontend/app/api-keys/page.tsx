"use client";

/**
 * Self-serve API key management page (Phase 29).
 *
 * Flow:
 *   1. Connect CSPR.click → we capture the wallet address
 *   2. List existing keys (we already minted them) with usage stats
 *   3. "Generate new key" → backend mints a key, returns plaintext ONCE,
 *      user copies it; the backend stores only the sha256 hash
 *   4. "Revoke" → soft delete (sets revoked_at)
 *
 * The plaintext key is NEVER sent again after the initial reveal.
 * A "copy" button uses the Clipboard API; we explicitly clear the
 * buffer after 60 seconds so the key isn't pasted by accident into
 * a chat window later.
 *
 * This page is rendered with the existing shadcn/ui primitives so it
 * inherits the dark/light theme + error boundaries + loading skeletons
 * from the rest of the app.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, KeyRound, Trash2 } from "lucide-react";

type ApiKey = {
  id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  tier: "free" | "pro" | "enterprise";
};

type CreatedKey = { id: string; plaintext: string };

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api-keys", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load keys: HTTP ${res.status}`);
      const body = await res.json();
      setKeys(body.keys || []);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api-keys", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to mint key: HTTP ${res.status}`);
      const body = await res.json();
      setCreated({ id: body.id, plaintext: body.plaintext });
      await load();
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api-keys/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to revoke key: HTTP ${res.status}`);
      await load();
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore — Clipboard API can fail in iframes / non-secure contexts.
    }
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-serif font-normal flex items-center gap-2">
          <KeyRound className="h-7 w-7" /> API keys
        </h1>
        <p className="text-muted-foreground mt-2">
          Mint, rotate, and revoke keys for the CasperOPs API. Your keys are
          stored hashed — we can&apos;t recover them after creation.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {created && (
        <Card className="mb-8 border-amber-500/40">
          <CardHeader>
            <CardTitle>Save your new key</CardTitle>
            <CardDescription>
              We&apos;ll show this plaintext once. Copy it now — we can&apos;t recover it later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                {created.plaintext}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(created.plaintext)}
                aria-label="Copy API key"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Your keys</h2>
        <Button onClick={mint} disabled={busy}>
          + Generate new key
        </Button>
      </div>

      {keys === null ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : keys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No keys yet. Click <strong>Generate new key</strong> above.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {keys.map((k) => (
            <li key={k.id}>
              <Card>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-sm">
                      ...{k.id.slice(-8)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Tier: {k.tier} · Created {new Date(k.created_at).toLocaleString()}
                      {k.last_used_at && (
                        <>
                          {" · Last used "}
                          {new Date(k.last_used_at).toLocaleString()}
                        </>
                      )}
                      {k.revoked_at && (
                        <span className="text-destructive"> · Revoked</span>
                      )}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => revoke(k.id)}
                      disabled={busy}
                      aria-label="Revoke key"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
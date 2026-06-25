/**
 * Sentry integration for the BlockOps frontend (Next.js).
 *
 * Mirrors `backend/utils/sentry.js`: initializes Sentry only when
 * `NEXT_PUBLIC_SENTRY_DSN` is set so dev environments don't accidentally
 * ship traces. When the package is not installed or the DSN is absent the
 * helper degrades to a console-only reporter.
 *
 * Usage:
 *   import { initSentryBrowser, captureException } from "@/lib/sentry";
 *
 *   // In app/layout.tsx (client side):
 *   initSentryBrowser();
 *
 *   // Anywhere in the client:
 *   try { ... } catch (err) { captureException(err, { toolId: 'transfer' }); }
 *
 * For server-side capture (API routes, server components) use
 * `initSentryServer()` + `captureExceptionServer()`.
 */

"use client";

type SentryLike = {
  init: (options: Record<string, unknown>) => void;
  captureException: (err: unknown, context?: Record<string, unknown>) => void;
};

let browserSentry: SentryLike | null = null;
let serverSentry: SentryLike | null = null;

const DSN =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) || "";
const ENV =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_ENV) ||
  process.env.NODE_ENV ||
  "development";
const SAMPLE_RATE = Number(
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE) || "0.05",
);

function loadBrowserSentry(): SentryLike | null {
  if (browserSentry) return browserSentry;
  if (typeof window === "undefined") return null;
  try {
    const mod = require("@sentry/nextjs") as { browser?: unknown } & SentryLike;
    browserSentry = mod.browser
      ? (mod as unknown as SentryLike)
      : (mod as unknown as SentryLike);
    return browserSentry;
  } catch {
    if (typeof console !== "undefined") {
      console.warn("[sentry] @sentry/nextjs not installed; client error reporting disabled.");
    }
    return null;
  }
}

function loadServerSentry(): SentryLike | null {
  if (serverSentry) return serverSentry;
  if (typeof window !== "undefined") return null;
  try {
    const mod = require("@sentry/nextjs") as SentryLike;
    serverSentry = mod;
    return serverSentry;
  } catch {
    return null;
  }
}

/**
 * Initialize the browser-side Sentry client. Safe to call multiple times;
 * subsequent calls are no-ops once initialized.
 */
export function initSentryBrowser(): void {
  if (!DSN) {
    if (typeof console !== "undefined") {
      console.info("[sentry] NEXT_PUBLIC_SENTRY_DSN not set; client error reporting disabled.");
    }
    return;
  }
  const Sentry = loadBrowserSentry();
  if (!Sentry) return;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    tracesSampleRate: SAMPLE_RATE,
  });
  if (typeof console !== "undefined") {
    console.info(`[sentry] browser initialized (env=${ENV}, sample=${SAMPLE_RATE})`);
  }
}

/**
 * Initialize the server-side Sentry (API routes + server components).
 */
export function initSentryServer(): void {
  if (!DSN) {
    return;
  }
  const Sentry = loadServerSentry();
  if (!Sentry) return;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    tracesSampleRate: SAMPLE_RATE,
  });
}

export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  if (!DSN) {
    if (typeof console !== "undefined") {
      console.error("[sentry] captured (DSN unset):", err, context);
    }
    return;
  }
  const Sentry =
    typeof window === "undefined" ? loadServerSentry() : loadBrowserSentry();
  if (!Sentry) {
    if (typeof console !== "undefined") {
      console.error("[sentry] captured (no client):", err, context);
    }
    return;
  }
  try {
    Sentry.captureException(err, { extra: context });
  } catch (reportErr) {
    if (typeof console !== "undefined") {
      console.error("[sentry] captureException threw:", reportErr);
    }
  }
}

export const __SENTRY_CONFIG__ = { DSN, ENV, SAMPLE_RATE };

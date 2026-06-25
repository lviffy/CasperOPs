/**
 * Casper wallet helpers built on top of @make-software/csprclick-core-client.
 *
 * CasperOPs uses CSPR.click as the canonical session/wallet connector.
 * All helpers gracefully handle the case where CSPR.click is not yet
 * initialized (return `null`/empty data so callers can render a "Connect"
 * prompt instead of throwing).
 */

import type { CSPRClickSDK } from "@make-software/csprclick-core-client";
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID, explorerUrl } from "./chains";
import { updateCompatibleUserWallet } from "./supabase";

export type CasperPublicKey = `0${string}${string}`;

export type ConnectedAccount = {
  publicKey: CasperPublicKey;
  provider: string;
  balance?: string;
  balanceMotes?: string;
  csprName?: string | null;
};

/**
 * CSPR.click configuration. Pulled from public env vars exposed to the browser.
 */
function getCsprClickConfig() {
  return {
    appName: process.env.NEXT_PUBLIC_CSPRCLICK_APP_NAME || "CasperOPs",
    appId: process.env.NEXT_PUBLIC_CSPRCLICK_APP_ID || "csprclick-template",
    providers: ["casper-wallet", "casper-signer", "ledger", "metamask-snap", "walletconnect"],
    chainName: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
    casperNode: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].rpcUrl,
    contentMode: "iframe" as const,
  };
}

/**
 * Initialize the CSPR.click SDK. Safe to call multiple times.
 */
export function initCsprClick(): CSPRClickSDK | null {
  if (typeof window === "undefined") return null;
  console.log("[initCsprClick] window.csprclick:", window.csprclick);
  if (!window.csprclick) return null;
  if (window.csprclick.appName && window.csprclick.appId) {
    console.log("[initCsprClick] SDK already initialized:", window.csprclick.appName);
    return window.csprclick;
  }

  const cfg = getCsprClickConfig();
  console.log("[initCsprClick] calling window.csprclick.init with config:", cfg);
  try {
    window.csprclick.init(cfg);
  } catch (err) {
    console.warn("[csprclick] init failed:", err);
    return null;
  }
  return window.csprclick;
}

/**
 * Connect to a Casper wallet provider via CSPR.click.
 * Returns the connected account, or `null` if the user cancelled.
 */
export async function connectWallet(provider = "casper-wallet"): Promise<ConnectedAccount | null> {
  console.log("[connectWallet] attempting connect. provider:", provider, "window.csprclick:", window.csprclick);
  const sdk = initCsprClick();
  if (!sdk) throw new Error("CSPR.click SDK not available");

  if (provider && provider !== "csprclick") {
    try {
      const account = await sdk.connect(provider);
      if (account) {
        return {
          publicKey: (account.public_key || "") as CasperPublicKey,
          provider,
          csprName: (account as any).cspr_name ?? null,
        };
      }
    } catch (err) {
      console.warn(`[connectWallet] direct connect to ${provider} failed, falling back to signIn modal:`, err);
    }
  }

  // Fallback: trigger standard CSPR.click sign-in modal
  return new Promise((resolve) => {
    let resolved = false;

    const handleSignedIn = (evt: any) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      console.log("[connectWallet] Event: csprclick:signed_in received inside promise", evt);
      if (evt?.account) {
        resolve({
          publicKey: evt.account.public_key,
          provider: evt.account.provider || provider || "casper-wallet",
          csprName: evt.account.cspr_name ?? null,
        });
      } else {
        resolve(null);
      }
    };

    const handleDisconnected = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      if (typeof sdk.off === "function") {
        sdk.off("csprclick:signed_in", handleSignedIn);
        sdk.off("csprclick:disconnected", handleDisconnected);
        sdk.off("csprclick:signed_out", handleDisconnected);
      }
    };

    if (typeof sdk.on === "function") {
      sdk.on("csprclick:signed_in", handleSignedIn);
      sdk.on("csprclick:disconnected", handleDisconnected);
      sdk.on("csprclick:signed_out", handleDisconnected);
    } else {
      console.warn("[connectWallet] Event emitter methods not available on SDK instance.");
      resolve(null);
      return;
    }

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, 5 * 60 * 1000);

    try {
      sdk.signIn();
    } catch (err) {
      console.error("[connectWallet] sdk.signIn failed:", err);
      resolved = true;
      cleanup();
      resolve(null);
    }
  });
}

/**
 * Disconnect the active wallet.
 */
export async function disconnectWallet(provider = "casper-wallet"): Promise<void> {
  const sdk = initCsprClick();
  if (!sdk) return;
  try {
    await sdk.disconnect(provider);
  } catch (err) {
    console.warn("[csprclick] disconnect failed:", err);
  }
}

/**
 * Get the currently active Casper account (or null if not connected).
 */
export async function getActiveAccount(): Promise<ConnectedAccount | null> {
  const sdk = initCsprClick();
  if (!sdk) return null;
  const account = await sdk.getActiveAccountAsync({ withBalance: true });
  if (!account) return null;
  const publicKey = (account.public_key || "") as CasperPublicKey;
  return {
    publicKey,
    provider: (account as any).provider || "casper-wallet",
    balance: account.liquid_balance,
    balanceMotes: account.liquid_balance,
    csprName: (account.cspr_name ?? null) as string | null | undefined,
  };
}

/**
 * List all known accounts the user has connected to this CSPR.click session.
 * The user can switch between them via {@link switchAccount}.
 */
export async function getKnownAccounts(): Promise<ConnectedAccount[]> {
  const sdk = initCsprClick();
  if (!sdk) return [];
  try {
    const accounts = await sdk.getKnownAccounts();
    return (accounts || []).map((a: any) => ({
      publicKey: (a.public_key || "") as CasperPublicKey,
      provider: a.provider || "casper-wallet",
      balance: a.liquid_balance,
      balanceMotes: a.liquid_balance,
      csprName: a.cspr_name ?? null,
    }));
  } catch (err) {
    console.warn("[csprclick] getKnownAccounts failed:", err);
    return [];
  }
}

/**
 * Switch to a different known account in the active CSPR.click session.
 */
export async function switchAccount(publicKey: string, provider = "casper-wallet"): Promise<void> {
  const sdk = initCsprClick();
  if (!sdk) throw new Error("CSPR.click SDK not available");
  await sdk.switchAccount(provider, { publicKey });
}

/**
 * Sign a deploy (CASPER JSON) via CSPR.click without broadcasting.
 */
export async function signDeploy(deployJson: object | string, signingPublicKey: string) {
  const sdk = initCsprClick();
  if (!sdk) throw new Error("CSPR.click SDK not available");
  return sdk.sign(deployJson, signingPublicKey);
}

/**
 * Sign an arbitrary UTF-8 message with the active CSPR.click key.
 * Returns `{ signature, publicKey }`.
 */
export async function signMessage(message: string, signingPublicKey: string) {
  const sdk = initCsprClick();
  if (!sdk) throw new Error("CSPR.click SDK not available");
  if (typeof (sdk as any).signMessage === "function") {
    return (sdk as any).signMessage(message, signingPublicKey);
  }
  const payload =
    typeof message === "string" ? message : new TextDecoder().decode(message as ArrayBuffer);
  const encoder = new TextEncoder().encode(payload);
  return (sdk as any).sign(encoder, signingPublicKey);
}

/**
 * Send a deploy via CSPR.click (signs + broadcasts).
 * Returns `{ deployHash, status }`.
 */
export async function sendDeploy(
  deployJson: object | string,
  signingPublicKey: string,
  waitProcessing = true,
) {
  const sdk = initCsprClick();
  if (!sdk) throw new Error("CSPR.click SDK not available");
  return sdk.send(deployJson, signingPublicKey, waitProcessing);
}

/**
 * Fetch the CSPR balance for a public key via CSPR.cloud.
 * Returns a value in CSPR (decimal) or `null` on failure.
 */
export async function fetchCsprBalance(publicKey: string): Promise<string | null> {
  if (!publicKey) return null;
  const base = CHAIN_CONFIGS[DEFAULT_CHAIN_ID].csprCloudUrl;
  const url = `${base.replace(/\/$/, "")}/accounts/${publicKey}/balance`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json: any = await res.json();
    const motes = Number(json?.balance ?? json?.data?.balance ?? 0);
    if (!Number.isFinite(motes) || motes <= 0) return "0";
    return (motes / 1_000_000_000).toFixed(4);
  } catch (err) {
    console.warn("[csprclick] balance fetch failed:", err);
    return null;
  }
}

/**
 * Backwards-compatible balance helper for older callers expecting
 * `{ native, symbol }`.
 */
export async function getTokenBalances(address: string): Promise<{ native: string; symbol: string }> {
  const native = (await fetchCsprBalance(address)) ?? "0.00";
  return { native, symbol: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].symbol };
}

/**
 * Persist the connected wallet's public key on the Supabase user row.
 */
export async function saveWalletToUser(userId: string, publicKey: string): Promise<void> {
  await updateCompatibleUserWallet(userId, {
    wallet_address: publicKey,
    wallet_type: "csprclick",
    ed25519_public_key: publicKey,
  });
}

export async function removeWalletFromUser(userId: string): Promise<void> {
  await updateCompatibleUserWallet(userId, {
    wallet_address: null,
    wallet_type: null,
    ed25519_public_key: null,
  });
}

/**
 * Convenience helper — returns the Casper explorer URL for an account.
 */
export function casperExplorerUrl(publicKey: string) {
  return explorerUrl(publicKey, "account");
}

/**
 * Convenience helper — returns the Casper explorer URL for a deploy hash.
 */
export function casperDeployUrl(deployHash: string) {
  return explorerUrl(deployHash, "deploy");
}

// =============================================================================
// ⚠️  LEGACY STUBS — EVM / Lit PKP helpers that used to live here.
// CasperOPs now signs Casper deploys via CSPR.click. The functions below throw
// helpful errors if anything still calls them; callers should migrate to the
// CSPR.click helpers above (connectWallet, getActiveAccount, sendDeploy, …).
// =============================================================================

/**
 * @deprecated Use `connectWallet()` (CSPR.click) instead.
 */
export function createWallet(): { address: string; privateKey: string } {
  throw new Error(
    "createWallet() is no longer supported — CasperOPs uses CSPR.click. " +
      "Call connectWallet() to bring a Casper wallet into the browser.",
  );
}

/**
 * @deprecated CSPR.click provides the active account's public key directly.
 */
export function getAddressFromPrivateKey(_privateKey: string): string {
  throw new Error(
    "getAddressFromPrivateKey() is no longer supported — CasperOPs uses CSPR.click. " +
      "Read the active account's public key via getActiveAccount().",
  );
}

/**
 * @deprecated CSPR.click handles private-key validation client-side.
 */
export function isValidPrivateKey(_privateKey: string): boolean {
  throw new Error(
    "isValidPrivateKey() is no longer supported — CSPR.click validates keys inside the wallet popup.",
  );
}

/**
 * @deprecated Kept only for backwards-compatible imports; CSPR.click manages secrets.
 */
export async function getTokenBalancesForChain(
  _address: string,
  _chain: string,
): Promise<{ native: string; symbol: string }> {
  return getTokenBalances(_address);
}

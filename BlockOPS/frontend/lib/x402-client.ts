/**
 * x402 client helper. Wraps any `fetch` call so paid tool invocations
 * automatically detect 402 responses, sign + broadcast a payment deploy via
 * CSPR.click, and retry the original request with the deploy-hash header.
 *
 * Usage:
 *   import { x402Fetch } from "@/lib/x402-client";
 *   const response = await x402Fetch("https://api.blockops.dev/v1/tools/register_agent", {
 *     method: "POST",
 *     body: JSON.stringify({ agentId: "agent-1" }),
 *   });
 *
 * The helper surfaces a DeployStatusIndicator toast with the deploy hash
 * and explorer link so the user can verify the payment on-chain.
 */

import { getActiveAccount, signDeploy, sendDeploy, casperDeployUrl } from "./wallet";

export interface X402Challenge {
  toolId: string;
  priceCspr: string;
  priceMotes: string;
  payToPublicKey: string;
  chainName: string;
  rpcUrl?: string;
  deployTemplate: {
    contractHash: string | null;
    entryPoint: string;
    args: Record<string, string>;
    chainName: string;
  };
  memo?: string;
  instructions?: string;
  error?: string;
}

export interface X402FetchOptions extends RequestInit {
  /**
   * Called whenever a 402 challenge is received so the UI can show a
   * "signing payment" indicator. If not provided, a default
   * `console.info` log is used.
   */
  onChallenge?: (challenge: X402Challenge) => void;
  /**
   * Called once the payment deploy has been signed and broadcast.
   */
  onPaymentSubmitted?: (info: { deployHash: string; explorerUrl: string }) => void;
  /**
   * Called when the user rejects the signing request or the deploy fails.
   * If the callback returns `false`, the original request is not retried
   * (the 402 response is returned to the caller).
   */
  onPaymentError?: (error: Error) => boolean | void;
  /**
   * If false, do NOT attempt to auto-sign; instead, return the 402 to the
   * caller. Defaults to true.
   */
  autoPay?: boolean;
}

const DEFAULT_PAYER_HEADER = "X-Casper-Payment-Payer-PublicKey";
const DEFAULT_DEPLOY_HEADER = "X-Casper-Payment-Deploy-Hash";

function isX402Response(res: Response): boolean {
  if (res.status === 402) return true;
  const tool = res.headers.get("X-Casper-Tool-Id");
  return Boolean(tool) && !res.ok;
}

async function readChallenge(res: Response): Promise<X402Challenge> {
  const json = (await res.json()) as Partial<X402Challenge>;
  return {
    toolId: json.toolId ?? "",
    priceCspr: json.priceCspr ?? "0.00",
    priceMotes: json.priceMotes ?? "0",
    payToPublicKey: json.payToPublicKey ?? "",
    chainName: json.chainName ?? "casper-test",
    rpcUrl: json.rpcUrl,
    deployTemplate: json.deployTemplate ?? {
      contractHash: null,
      entryPoint: "transfer",
      args: {},
      chainName: json.chainName ?? "casper-test",
    },
    memo: json.memo,
    instructions: json.instructions,
    error: json.error,
  };
}

export async function x402Fetch(
  input: RequestInfo | URL,
  options: X402FetchOptions = {},
): Promise<Response> {
  const { onChallenge, onPaymentSubmitted, onPaymentError, autoPay = true, headers, ...rest } = options;
  const mergedHeaders = new Headers(headers || {});

  const initial = await fetch(input, { ...rest, headers: mergedHeaders });
  if (!isX402Response(initial)) return initial;

  const challenge = await readChallenge(initial);
  onChallenge?.(challenge);

  if (autoPay === false) return initial;

  let account;
  try {
    account = await getActiveAccount();
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    const fallback = onPaymentError?.(wrapped);
    if (fallback === false) return initial;
    throw wrapped;
  }
  if (!account?.publicKey) {
    const err = new Error("Connect a CSPR.click wallet to pay for paid tools.");
    const fallback = onPaymentError?.(err);
    if (fallback === false) return initial;
    throw err;
  }

  let deployHash: string;
  try {
    const result = await sendDeploy(challenge.deployTemplate, account.publicKey, false);
    if (!result?.deployHash) {
      throw new Error("CSPR.click did not return a deploy hash.");
    }
    deployHash = result.deployHash;
    onPaymentSubmitted?.({
      deployHash,
      explorerUrl: casperDeployUrl(deployHash),
    });
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    const fallback = onPaymentError?.(wrapped);
    if (fallback === false) return initial;
    throw wrapped;
  }

  mergedHeaders.set(DEFAULT_DEPLOY_HEADER, deployHash);
  mergedHeaders.set(DEFAULT_PAYER_HEADER, account.publicKey);

  return fetch(input, { ...rest, headers: mergedHeaders });
}

export { isX402Response, readChallenge };

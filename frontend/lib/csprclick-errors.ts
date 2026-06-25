/**
 * CSPR.click error mapper. Translates raw wallet errors into friendly,
 * actionable messages the UI can show. The CasperOPs frontend uses this in
 * every code path that calls `connectWallet`, `signDeploy`, `signMessage`,
 * and `sendDeploy`.
 */

export type CsprClickErrorCode =
  | "user_rejected_sign"
  | "user_rejected_connect"
  | "insufficient_balance"
  | "locked_wallet"
  | "unavailable"
  | "wrong_chain"
  | "unknown"

export interface MappedCsprError {
  code: CsprClickErrorCode
  title: string
  message: string
  /** When non-null, the UI should surface this as a clickable link. */
  ctaLabel?: string
  ctaHref?: string
}

const KNOWN_CODES: Record<string, MappedCsprError> = {
  user_rejected_sign: {
    code: "user_rejected_sign",
    title: "Signing cancelled",
    message: "You declined the signing request. Your deploy was not submitted.",
  },
  user_rejected_connect: {
    code: "user_rejected_connect",
    title: "Connection cancelled",
    message: "You declined the wallet connection. Nothing was changed.",
  },
  insufficient_balance: {
    code: "insufficient_balance",
    title: "Not enough CSPR",
    message:
      "Your wallet does not have enough CSPR to cover this deploy payment (≈ 0.25 CSPR). Fund the account and try again.",
    ctaLabel: "Open testnet faucet",
    ctaHref: "https://testnet.cspr.live/tools/faucet",
  },
  locked_wallet: {
    code: "locked_wallet",
    title: "Wallet is locked",
    message: "Open the Casper Wallet extension and unlock it, then retry.",
  },
  unavailable: {
    code: "unavailable",
    title: "Wallet unavailable",
    message:
      "The Casper Wallet extension is not installed. Install it or choose a different provider.",
  },
  wrong_chain: {
    code: "wrong_chain",
    title: "Wrong network",
    message: "Switch your Casper Wallet to the Casper Testnet and try again.",
  },
}

const CODE_PATTERNS: Array<[RegExp, CsprClickErrorCode]> = [
  [/(user.*(reject|denied|cancel))|((reject|denied|cancel).*user)/i, "user_rejected_sign"],
  [/insufficient.*(balance|funds)/i, "insufficient_balance"],
  [/wallet.*(locked|locked_please_unlock)/i, "locked_wallet"],
  [/no.*(provider|wallet).*available|not.*installed/i, "unavailable"],
  [/wrong.*(chain|network)|expected.*casper/i, "wrong_chain"],
]

export function mapCsprClickError(err: unknown): MappedCsprError {
  const raw = ((): string => {
    if (typeof err === "string") return err
    if (err && typeof err === "object") {
      const e = err as { code?: unknown; message?: unknown; reason?: unknown }
      return [e.code, e.message, e.reason].filter(Boolean).join(" | ")
    }
    return ""
  })()

  if (raw) {
    for (const [pattern, code] of CODE_PATTERNS) {
      if (pattern.test(raw)) return KNOWN_CODES[code]
    }
  }
  return {
    code: "unknown",
    title: "Wallet error",
    message: raw || "CSPR.click reported an unknown error. Check the console for details.",
  }
}

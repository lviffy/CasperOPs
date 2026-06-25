/**
 * CasperOPs Casper contract addresses.
 *
 * All hashes are `hash-<64hex>` Casper contract-hash format. The defaults are
 * placeholders — replace them with the real hashes produced by
 * `cd contract && node scripts/deploy.js`. See `docs/testnet-validation.md`
 * for the canonical testnet deploy log.
 */

const isHash = (v: string | undefined): v is `hash-${string}` =>
  !!v && /^hash-[0-9a-fA-F]{64}$/.test(v);

const envHash = (name: string): `hash-${string}` | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (isHash(raw)) return raw as `hash-${string}`;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `hash-${raw.toLowerCase()}` as `hash-${string}`;
  return undefined;
};

const PLACEHOLDER_FACTORY = "hash-0000000000000000000000000000000000000000000000000000000000000000";
const PLACEHOLDER_REPUTATION = "hash-0000000000000000000000000000000000000000000000000000000000000000";
const PLACEHOLDER_ESCROW = "hash-0000000000000000000000000000000000000000000000000000000000000000";
const PLACEHOLDER_COMPLIANCE = "hash-0000000000000000000000000000000000000000000000000000000000000000";
const PLACEHOLDER_CEP18 = "hash-0000000000000000000000000000000000000000000000000000000000000000";
const PLACEHOLDER_CEP78 = "hash-0000000000000000000000000000000000000000000000000000000000000000";

export const AGENT_FACTORY_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH") ?? PLACEHOLDER_FACTORY;

export const REPUTATION_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_REPUTATION_CONTRACT_HASH") ?? PLACEHOLDER_REPUTATION;

export const ESCROW_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_ESCROW_CONTRACT_HASH") ?? PLACEHOLDER_ESCROW;

export const COMPLIANCE_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH") ?? PLACEHOLDER_COMPLIANCE;

export const CEP18_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_CEP18_CONTRACT_HASH") ?? PLACEHOLDER_CEP18;

export const CEP78_CONTRACT_HASH: `hash-${string}` =
  envHash("NEXT_PUBLIC_CEP78_CONTRACT_HASH") ?? PLACEHOLDER_CEP78;

/**
 * The Casper account (public key, hex with 0x/01 prefix) that receives x402
 * tool payments. Defaults to a CasperOPs-controlled testnet key; override
 * with `NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY` for production.
 */
export const PAYMENT_RECIPIENT_PUBLIC_KEY: string =
  process.env.NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY ??
  "010101010101010101010101010101010101010101010101010101010101010101";

export interface ContractEntryPoints {
  register_agent?: string;
  attest_agent?: string;
  transfer?: string;
  mint?: string;
  deposit?: string;
  payout?: string;
  refund?: string;
}

/**
 * Canonical entry-point names per contract. Kept centralized so the frontend
 * never hardcodes string literals.
 */
export const ENTRY_POINTS: Record<keyof typeof CONTRACT_HASHES, ContractEntryPoints> = {
  AGENT_FACTORY: { register_agent: "register_agent" },
  REPUTATION: { attest_agent: "attest_agent" },
  ESCROW: { deposit: "deposit", payout: "execute_payout", refund: "refund" },
  COMPLIANCE: {},
  CEP18: { transfer: "transfer" },
  CEP78: { mint: "mint" },
};

export const CONTRACT_HASHES = {
  AGENT_FACTORY: AGENT_FACTORY_CONTRACT_HASH,
  REPUTATION: REPUTATION_CONTRACT_HASH,
  ESCROW: ESCROW_CONTRACT_HASH,
  COMPLIANCE: COMPLIANCE_CONTRACT_HASH,
  CEP18: CEP18_CONTRACT_HASH,
  CEP78: CEP78_CONTRACT_HASH,
} as const;

/**
 * Convenience helper to look up an entry point name (e.g. "register_agent").
 * Falls back to the literal name when no mapping is configured.
 */
export function resolveEntryPoint(
  contract: keyof typeof CONTRACT_HASHES,
  rawName: string,
): string {
  return ENTRY_POINTS[contract]?.[rawName as keyof ContractEntryPoints] ?? rawName;
}

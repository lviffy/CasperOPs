import { ethers } from "ethers"

export const LIT_PRIVATE_KEY_PREFIX = "lit:v1:"
const LIT_PRIVATE_KEY_PROVIDERS = ["lit-chipotle", "lit-naga-test"] as const
type LitPrivateKeyProvider = (typeof LIT_PRIVATE_KEY_PROVIDERS)[number]

export interface LitStoredPrivateKeyPayload {
  version: 1
  provider: LitPrivateKeyProvider
  pkpId: string
  ciphertext: string
  createdAt: string
}

const PRIVATE_KEY_REGEX = /^(0x)?[0-9a-fA-F]{64}$/
const decryptedKeyCache = new Map<string, string>()

export function isRawPrivateKey(privateKey: string | null | undefined): boolean {
  return !!privateKey && PRIVATE_KEY_REGEX.test(privateKey.trim())
}

export function isLitStoredPrivateKey(privateKey: string | null | undefined): boolean {
  return !!privateKey && privateKey.startsWith(LIT_PRIVATE_KEY_PREFIX)
}

export function hasStoredSigningKey(privateKey: string | null | undefined): boolean {
  if (isRawPrivateKey(privateKey)) {
    return true
  }

  if (isLitStoredPrivateKey(privateKey)) {
    try {
      parseLitStoredPrivateKey(privateKey as string)
      return true
    } catch {
      return false
    }
  }

  return false
}

export function normalizePrivateKey(privateKey: string): string {
  const trimmed = privateKey.trim()
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
  return ethers.hexlify(prefixed as ethers.BytesLike)
}

export function serializeLitStoredPrivateKey(payload: LitStoredPrivateKeyPayload): string {
  return `${LIT_PRIVATE_KEY_PREFIX}${JSON.stringify(payload)}`
}

function isSupportedLitProvider(provider: unknown): provider is LitPrivateKeyProvider {
  return typeof provider === "string" && LIT_PRIVATE_KEY_PROVIDERS.includes(provider as LitPrivateKeyProvider)
}

export function parseLitStoredPrivateKey(privateKey: string): LitStoredPrivateKeyPayload {
  if (!isLitStoredPrivateKey(privateKey)) {
    throw new Error("Not a Lit-managed private key payload")
  }

  const rawJson = privateKey.slice(LIT_PRIVATE_KEY_PREFIX.length)

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error("Invalid Lit private key payload format")
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as any).version !== 1 ||
    !isSupportedLitProvider((parsed as any).provider) ||
    typeof (parsed as any).pkpId !== "string" ||
    typeof (parsed as any).ciphertext !== "string"
  ) {
    throw new Error("Invalid Lit private key payload schema")
  }

  return parsed as LitStoredPrivateKeyPayload
}

export async function encryptPrivateKeyForStorage(privateKey: string): Promise<string> {
  const normalizedPrivateKey = normalizePrivateKey(privateKey)

  const response = await fetch("/api/lit/private-key/encrypt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ privateKey: normalizedPrivateKey }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Failed to encrypt private key" }))
    throw new Error(errorData.error || "Failed to encrypt private key")
  }

  const data = await response.json()
  if (!data?.ciphertext || !data?.pkpId) {
    throw new Error("Lit encryption response was incomplete")
  }

  return serializeLitStoredPrivateKey({
    version: 1,
    provider: "lit-naga-test",
    pkpId: data.pkpId,
    ciphertext: data.ciphertext,
    createdAt: new Date().toISOString(),
  })
}

export async function decryptStoredPrivateKey(storedPrivateKey: string | null | undefined): Promise<string | null> {
  if (!storedPrivateKey) return null

  if (isRawPrivateKey(storedPrivateKey)) {
    return normalizePrivateKey(storedPrivateKey)
  }

  if (!isLitStoredPrivateKey(storedPrivateKey)) {
    return null
  }

  if (decryptedKeyCache.has(storedPrivateKey)) {
    return decryptedKeyCache.get(storedPrivateKey) || null
  }

  const payload = parseLitStoredPrivateKey(storedPrivateKey)

  const response = await fetch("/api/lit/private-key/decrypt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pkpId: payload.pkpId,
      ciphertext: payload.ciphertext,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Failed to decrypt private key" }))
    throw new Error(errorData.error || "Failed to decrypt private key")
  }

  const data = await response.json()
  const plaintext = typeof data?.plaintext === "string" ? data.plaintext : null

  if (!plaintext || !isRawPrivateKey(plaintext)) {
    throw new Error("Lit decrypt returned an invalid private key")
  }

  const normalizedPrivateKey = normalizePrivateKey(plaintext)
  decryptedKeyCache.set(storedPrivateKey, normalizedPrivateKey)

  return normalizedPrivateKey
}

import "server-only"

import path from "path"
import { randomUUID } from "crypto"
import { ethers } from "ethers"
import { createAuthManager, storagePlugins, ViemAccountAuthenticator } from "@lit-protocol/auth"
import { createLitClient } from "@lit-protocol/lit-client"
import { nagaTest } from "@lit-protocol/networks"
import { arbitrumSepolia, flowTestnet } from "viem/chains"
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { getChainConfig, normalizeChainId, type SupportedChainId } from "./chains"

interface LitActionRequest {
  code: string
  jsParams?: Record<string, unknown>
}

interface LitActionResponse {
  has_error?: boolean
  logs?: string
  response?: unknown
}

interface PkpTransactionRequest {
  to: string
  data?: string | null
  value?: string | null
  gas?: string | null
  maxFeePerGas?: string | null
  maxPriorityFeePerGas?: string | null
  nonce?: number | null
}

const DEFAULT_LIT_API_BASE_URL = "https://api.dev.litprotocol.com/core/v1"
const DEFAULT_LIT_APP_NAME = "blockops"
const DEFAULT_ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"
const DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS = 20000
const DEFAULT_AUTH_RESOURCES = [
  { ability: "pkp-signing", resource: "*" },
  { ability: "lit-action-execution", resource: "*" },
] as const

const ENCRYPT_ACTION_CODE = `
async function main({ pkpId, secret }) {
  const ciphertext = await Lit.Actions.Encrypt({ pkpId, message: secret });
  return { ciphertext };
}
`

const DECRYPT_ACTION_CODE = `
async function main({ pkpId, ciphertext }) {
  const plaintext = await Lit.Actions.Decrypt({ pkpId, ciphertext });
  return { plaintext };
}
`

let litClientPromise: ReturnType<typeof createLitClient> | null = null
let authManagerInstance: ReturnType<typeof createAuthManager> | null = null
let controllerAuthDataPromise: Promise<Awaited<ReturnType<typeof ViemAccountAuthenticator.authenticate>>> | null = null

function getLegacyLitConfig() {
  const apiBaseUrl = (process.env.LIT_API_BASE_URL || DEFAULT_LIT_API_BASE_URL).replace(/\/$/, "")
  const apiKey = process.env.LIT_USAGE_API_KEY
  const defaultPkpId = process.env.LIT_PKP_ID

  if (!apiKey) {
    throw new Error("Lit is not configured: missing LIT_USAGE_API_KEY")
  }

  if (!defaultPkpId) {
    throw new Error("Lit is not configured: missing LIT_PKP_ID")
  }

  return { apiBaseUrl, apiKey, defaultPkpId }
}

function getPkpConfig() {
  const controllerPrivateKey = process.env.LIT_PKP_CONTROLLER_PRIVATE_KEY
  const appDomain =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.BLOCKOPS_PUBLIC_URL ||
    "http://localhost:3001"
  const appName = process.env.LIT_APP_NAME || DEFAULT_LIT_APP_NAME
  const arbitrumRpcUrl =
    process.env.ARBITRUM_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    DEFAULT_ARBITRUM_SEPOLIA_RPC_URL
  const storagePath = process.env.LIT_AUTH_STORAGE_PATH || path.join(process.cwd(), ".lit-auth")
  const handshakeTimeoutMs = Number(
    process.env.LIT_NAGA_HANDSHAKE_TIMEOUT_MS || DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS
  )

  if (!controllerPrivateKey) {
    throw new Error("Lit PKP signing is not configured: missing LIT_PKP_CONTROLLER_PRIVATE_KEY")
  }

  return {
    appDomain,
    appName,
    arbitrumRpcUrl,
    controllerPrivateKey,
    handshakeTimeoutMs: Number.isFinite(handshakeTimeoutMs)
      ? Math.max(handshakeTimeoutMs, DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS)
      : DEFAULT_LIT_HANDSHAKE_TIMEOUT_MS,
    storagePath,
  }
}

function getNagaNetwork() {
  const { handshakeTimeoutMs } = getPkpConfig()

  return {
    ...nagaTest,
    config: {
      ...nagaTest.config,
      abortTimeout: handshakeTimeoutMs,
    },
  }
}

function formatLitHandshakeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/Insufficient successful handshakes/i.test(message)) {
    const { handshakeTimeoutMs } = getPkpConfig()
    return new Error(
      `Could not reach enough Lit Naga testnet nodes to mint/sign a PKP. The SDK requires at least 3 successful node handshakes, but your server reached fewer than that. Check firewall/VPN/proxy settings, allow outbound HTTPS/WebSocket traffic to Lit nodes, and try again. Current handshake timeout: ${handshakeTimeoutMs}ms.`
    )
  }

  return error instanceof Error ? error : new Error(message)
}

function parseLitResponsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
      return { value: parsed }
    } catch {
      return { value: payload }
    }
  }

  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>
  }

  return { value: payload }
}

async function runLitAction<T extends Record<string, unknown>>({
  code,
  jsParams,
}: LitActionRequest): Promise<T> {
  const { apiBaseUrl, apiKey } = getLegacyLitConfig()
  const requestId = randomUUID()

  const response = await fetch(`${apiBaseUrl}/lit_action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Request-Id": requestId,
    },
    body: JSON.stringify({
      code,
      js_params: jsParams || {},
    }),
  })

  let body: LitActionResponse | string
  try {
    body = await response.json()
  } catch {
    body = await response.text()
  }

  if (!response.ok) {
    const message = typeof body === "string" ? body : body?.logs || JSON.stringify(body)
    throw new Error(`Lit action request failed (${response.status}): ${message}`)
  }

  if (typeof body !== "object" || body === null) {
    throw new Error("Lit action returned an invalid response")
  }

  if (body.has_error) {
    throw new Error(body.logs || "Lit action execution failed")
  }

  return parseLitResponsePayload(body.response) as T
}

function getControllerAccount() {
  const { controllerPrivateKey } = getPkpConfig()
  return privateKeyToAccount(controllerPrivateKey as Hex)
}

async function getLitClient() {
  if (!litClientPromise) {
    litClientPromise = createLitClient({ network: getNagaNetwork() }).catch((error) => {
      litClientPromise = null
      throw formatLitHandshakeError(error)
    })
  }

  return litClientPromise
}

function getAuthManager() {
  if (!authManagerInstance) {
    const { appName, storagePath } = getPkpConfig()
    authManagerInstance = createAuthManager({
      storage: storagePlugins.localStorageNode({
        appName,
        networkName: "naga-test",
        storagePath,
      }),
    })
  }

  return authManagerInstance
}

async function getControllerAuthData() {
  if (!controllerAuthDataPromise) {
    controllerAuthDataPromise = ViemAccountAuthenticator.authenticate(getControllerAccount())
  }

  return controllerAuthDataPromise
}

function getAuthConfig() {
  const { appDomain } = getPkpConfig()

  return {
    resources: DEFAULT_AUTH_RESOURCES.map((resource) => ({ ...resource })),
    expiration: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    statement: "BlockOps delegated PKP session",
    domain: appDomain,
  }
}

function resolveViemChain(chain?: SupportedChainId | Chain): Chain {
  if (typeof chain === "object" && chain?.id) {
    return chain
  }

  const normalized = normalizeChainId(typeof chain === "string" ? chain : undefined)
  return normalized === "flow-testnet" ? flowTestnet : arbitrumSepolia
}

function getChainClients(chain: Chain = arbitrumSepolia) {
  const viemChain = resolveViemChain(chain)
  const chainConfig = getChainConfig(viemChain.id === 545 ? "flow-testnet" : "arbitrum-sepolia")
  const transport = http(chainConfig.viemChain.rpcUrls.default.http[0])

  return {
    chain: viemChain,
    publicClient: createPublicClient({
      chain: viemChain,
      transport,
    }),
    transport,
  }
}

async function createPkpWalletClient(pkpPublicKey: string, chain: Chain = arbitrumSepolia) {
  const litClient = await getLitClient()
  const authManager = getAuthManager()
  const authData = await getControllerAuthData()
  const authContext = await authManager.createPkpAuthContext({
    authData,
    pkpPublicKey,
    authConfig: getAuthConfig(),
    litClient,
  })
  const { publicClient, transport, chain: viemChain } = getChainClients(chain)
  const pkpAccount = await litClient.getPkpViemAccount({
    pkpPublicKey,
    authContext,
    chainConfig: viemChain,
  })

  const walletClient = createWalletClient({
    account: pkpAccount,
    chain: viemChain,
    transport,
  })

  return {
    publicClient,
    walletClient,
    pkpAccount,
  }
}

function normalizeBigInt(value: string | number | bigint | null | undefined): bigint | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined
  }

  if (typeof value === "bigint") {
    return value
  }

  return BigInt(value)
}

function normalizeTransaction(transaction: PkpTransactionRequest) {
  return {
    to: transaction.to as Hex,
    data: transaction.data ? (transaction.data as Hex) : undefined,
    value: normalizeBigInt(transaction.value) ?? BigInt(0),
    gas: normalizeBigInt(transaction.gas),
    maxFeePerGas: normalizeBigInt(transaction.maxFeePerGas),
    maxPriorityFeePerGas: normalizeBigInt(transaction.maxPriorityFeePerGas),
    nonce: transaction.nonce ?? undefined,
  }
}

export async function encryptSecretWithLit(secret: string, pkpId?: string) {
  const { defaultPkpId } = getLegacyLitConfig()
  const finalPkpId = pkpId || defaultPkpId

  const data = await runLitAction<{ ciphertext?: string }>({
    code: ENCRYPT_ACTION_CODE,
    jsParams: {
      pkpId: finalPkpId,
      secret,
    },
  })

  const ciphertext = typeof data.ciphertext === "string" ? data.ciphertext : null
  if (!ciphertext) {
    throw new Error("Lit encryption did not return ciphertext")
  }

  return {
    pkpId: finalPkpId,
    ciphertext,
  }
}

export async function decryptSecretWithLit(ciphertext: string, pkpId?: string) {
  const { defaultPkpId } = getLegacyLitConfig()
  const finalPkpId = pkpId || defaultPkpId

  const data = await runLitAction<{ plaintext?: string }>({
    code: DECRYPT_ACTION_CODE,
    jsParams: {
      pkpId: finalPkpId,
      ciphertext,
    },
  })

  const plaintext = typeof data.plaintext === "string" ? data.plaintext : null
  if (!plaintext) {
    throw new Error("Lit decryption did not return plaintext")
  }

  return {
    pkpId: finalPkpId,
    plaintext,
  }
}

export async function mintPkpWalletOnNagaTest() {
  const litClient = await getLitClient()
  const controllerAccount = getControllerAccount()
  const authData = await getControllerAuthData()

  const mintedResponse = await litClient.mintWithAuth({
    account: controllerAccount,
    authData,
    scopes: ["sign-anything"],
  })

  const minted = mintedResponse?.data || mintedResponse?._raw?.data
  if (!minted?.pubkey || minted?.tokenId === undefined || minted?.tokenId === null) {
    throw new Error("Lit PKP mint did not return a public key and tokenId")
  }

  return {
    walletType: "pkp" as const,
    walletAddress: minted.ethAddress || ethers.computeAddress(minted.pubkey),
    pkpPublicKey: minted.pubkey,
    pkpTokenId: minted.tokenId.toString(),
    mintedAt: new Date().toISOString(),
  }
}

export async function signAndBroadcastTransactionWithPkp(params: {
  pkpPublicKey: string
  transaction: PkpTransactionRequest
  chain?: SupportedChainId | Chain
}) {
  const viemChain = resolveViemChain(params.chain)
  const chainConfig = getChainConfig(viemChain.id === 545 ? "flow-testnet" : "arbitrum-sepolia")
  const { walletClient, publicClient, pkpAccount } = await createPkpWalletClient(
    params.pkpPublicKey,
    viemChain
  )

  const hash = await walletClient.sendTransaction({
    ...normalizeTransaction(params.transaction),
    account: pkpAccount,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  return {
    hash,
    explorerUrl: `${chainConfig.explorerBaseUrl}/tx/${hash}`,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status === "success" ? "success" : "failed",
    receipt,
  }
}

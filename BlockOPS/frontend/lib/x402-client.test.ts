/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted to the top of the file by vitest, so the factory cannot
// reference top-level `const` bindings. Use `vi.hoisted` to create the mock
// state, then point `vi.mock` at it.
const walletMock = vi.hoisted(() => ({
  getActiveAccount: vi.fn(),
  signDeploy: vi.fn(),
  sendDeploy: vi.fn(),
  casperDeployUrl: vi.fn((hash: string) => `https://testnet.cspr.live/deploy/${hash}`),
}));

vi.mock("./wallet", () => walletMock);

import { x402Fetch, isX402Response, readChallenge } from "./x402-client";

const PAYER_PUBKEY = "01aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
const DEPLOY_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

const challengeBody = {
  toolId: "register_agent",
  priceCspr: "0.50",
  priceMotes: "500000000",
  payToPublicKey: "01" + "b".repeat(64),
  chainName: "casper-test",
  deployTemplate: {
    contractHash: "hash-" + "a".repeat(64),
    entryPoint: "transfer",
    args: {
      recipient: "01" + "b".repeat(64),
      amount: "500000000",
    },
    chainName: "casper-test",
  },
  memo: "BlockOps tool payment: register_agent",
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset fetch between tests.
  ;(globalThis as any).fetch = vi.fn()
})

function mockFetchResponseOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: new Headers(headers),
    json: async () => body,
  })
}

function statusText(status: number): string {
  return (
    {
      200: "OK",
      402: "Payment Required",
      500: "Internal Server Error",
    } as Record<number, string>
  )[status] || ""
}

describe("x402-client", () => {
  describe("isX402Response", () => {
    it("returns true for HTTP 402", () => {
      const res = { status: 402, ok: false, headers: new Headers() } as unknown as Response
      expect(isX402Response(res)).toBe(true)
    })
    it("returns true for non-OK response carrying the X-Casper-Tool-Id header", () => {
      const res = {
        status: 503,
        ok: false,
        headers: new Headers({ "X-Casper-Tool-Id": "register_agent" }),
      } as unknown as Response
      expect(isX402Response(res)).toBe(true)
    })
    it("returns false for a normal 2xx response", () => {
      const res = { status: 200, ok: true, headers: new Headers() } as unknown as Response
      expect(isX402Response(res)).toBe(false)
    })
  })

  describe("readChallenge", () => {
    it("fills in defaults when the server omits optional fields", async () => {
      const res = {
        status: 402,
        ok: false,
        headers: new Headers(),
        json: async () => ({ toolId: "register_agent" }),
      } as unknown as Response
      const challenge = await readChallenge(res)
      expect(challenge.toolId).toBe("register_agent")
      expect(challenge.priceCspr).toBe("0.00")
      expect(challenge.priceMotes).toBe("0")
      expect(challenge.payToPublicKey).toBe("")
      expect(challenge.chainName).toBe("casper-test")
      expect(challenge.deployTemplate.entryPoint).toBe("transfer")
      expect(challenge.deployTemplate.contractHash).toBe(null)
    })
    it("round-trips the deployTemplate the server returns", async () => {
      const res = {
        status: 402,
        ok: false,
        headers: new Headers(),
        json: async () => challengeBody,
      } as unknown as Response
      const challenge = await readChallenge(res)
      expect(challenge.toolId).toBe("register_agent")
      expect(challenge.priceCspr).toBe("0.50")
      expect(challenge.deployTemplate.contractHash).toBe(challengeBody.deployTemplate.contractHash)
      expect(challenge.deployTemplate.args.amount).toBe("500000000")
    })
  })

  describe("x402Fetch", () => {
    it("passes a non-402 response through unchanged", async () => {
      mockFetchResponseOnce(200, { ok: true })
      const res = await x402Fetch("https://api.example.com/v1/tools/get_balance")
      expect(res.status).toBe(200)
      const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("returns the 402 immediately when autoPay is false", async () => {
      mockFetchResponseOnce(402, challengeBody)
      const res = await x402Fetch("https://api.example.com/v1/tools/register_agent", {
        autoPay: false,
      })
      expect(res.status).toBe(402)
      const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(walletMock.getActiveAccount).not.toHaveBeenCalled()
      expect(walletMock.sendDeploy).not.toHaveBeenCalled()
    })

    it("calls onChallenge when a 402 is received", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue({ publicKey: PAYER_PUBKEY })
      walletMock.sendDeploy.mockResolvedValue({ deployHash: DEPLOY_HASH })
      mockFetchResponseOnce(200, { paid: true })
      const onChallenge = vi.fn()
      await x402Fetch("https://api.example.com/v1/tools/register_agent", { onChallenge })
      expect(onChallenge).toHaveBeenCalledTimes(1)
      expect(onChallenge.mock.calls[0][0].toolId).toBe("register_agent")
    })

    it("signs + broadcasts the payment deploy and retries with the deploy-hash header", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue({ publicKey: PAYER_PUBKEY })
      walletMock.sendDeploy.mockResolvedValue({ deployHash: DEPLOY_HASH })
      mockFetchResponseOnce(200, { ok: true })
      const onPaymentSubmitted = vi.fn()
      await x402Fetch("https://api.example.com/v1/tools/register_agent", { onPaymentSubmitted })
      expect(walletMock.sendDeploy).toHaveBeenCalledWith(
        challengeBody.deployTemplate,
        PAYER_PUBKEY,
        false,
      )
      expect(onPaymentSubmitted).toHaveBeenCalledWith({
        deployHash: DEPLOY_HASH,
        explorerUrl: `https://testnet.cspr.live/deploy/${DEPLOY_HASH}`,
      })
      const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const retryInit = fetchMock.mock.calls[1][1] as RequestInit
      const headers = new Headers(retryInit.headers)
      expect(headers.get("X-Casper-Payment-Deploy-Hash")).toBe(DEPLOY_HASH)
      expect(headers.get("X-Casper-Payment-Payer-PublicKey")).toBe(PAYER_PUBKEY)
    })

    it("does not crash when the user rejects the signing prompt", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue({ publicKey: PAYER_PUBKEY })
      const signingError = new Error("user_rejected_sign: signing cancelled by user")
      walletMock.sendDeploy.mockRejectedValue(signingError)
      const onPaymentError = vi.fn().mockReturnValue(false) // tell x402 to return the 402
      await x402Fetch("https://api.example.com/v1/tools/register_agent", { onPaymentError })
      expect(onPaymentError).toHaveBeenCalledWith(signingError)
      // fetch was called exactly once (the 402) — no retry after rejection.
      const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("rethrows the signing error when onPaymentError returns undefined (default)", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue({ publicKey: PAYER_PUBKEY })
      walletMock.sendDeploy.mockRejectedValue(new Error("csprclick disconnected"))
      await expect(
        x402Fetch("https://api.example.com/v1/tools/register_agent"),
      ).rejects.toThrow("csprclick disconnected")
    })

    it("throws a clear error when no wallet is connected and onPaymentError is not provided", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue(null)
      await expect(
        x402Fetch("https://api.example.com/v1/tools/register_agent"),
      ).rejects.toThrow(/CSPR\.click wallet/)
    })

    it("returns the 402 when the wallet is not connected and onPaymentError returns false", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue(null)
      const onPaymentError = vi.fn().mockReturnValue(false)
      const res = await x402Fetch("https://api.example.com/v1/tools/register_agent", {
        onPaymentError,
      })
      expect(res.status).toBe(402)
      expect(onPaymentError).toHaveBeenCalled()
    })

    it("preserves the original method + body on the retry", async () => {
      mockFetchResponseOnce(402, challengeBody)
      walletMock.getActiveAccount.mockResolvedValue({ publicKey: PAYER_PUBKEY })
      walletMock.sendDeploy.mockResolvedValue({ deployHash: DEPLOY_HASH })
      mockFetchResponseOnce(200, { ok: true })
      await x402Fetch("https://api.example.com/v1/tools/register_agent", {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-1" }),
      })
      const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>
      const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
      expect(retryInit.method).toBe("POST")
      expect(retryInit.body).toBe(JSON.stringify({ agentId: "agent-1" }))
    })
  })
})

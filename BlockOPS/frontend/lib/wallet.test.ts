/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the CSPR.click SDK before importing the wallet helpers.
const sdkMock = {
  appName: undefined as string | undefined,
  appId: undefined as string | undefined,
  init: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getActiveAccountAsync: vi.fn(),
  getKnownAccounts: vi.fn(),
  switchAccount: vi.fn(),
  sign: vi.fn(),
  send: vi.fn(),
  signMessage: vi.fn(),
}

// @ts-expect-error - we deliberately attach a partial mock to window.csprclick
;(globalThis as any).window = { csprclick: sdkMock }

import {
  initCsprClick,
  connectWallet,
  disconnectWallet,
  getActiveAccount,
  getKnownAccounts,
  switchAccount,
  signDeploy,
  signMessage,
  sendDeploy,
  fetchCsprBalance,
} from "./wallet"

describe("wallet (CSPR.click)", () => {
  beforeEach(() => {
    Object.entries(sdkMock).forEach(([key, value]) => {
      if (typeof value === "function" && "mockReset" in value) {
        ;(value as any).mockReset()
      } else if (key === "appName" || key === "appId") {
        ;(sdkMock as any)[key] = undefined
      }
    })
  })

  it("initCsprClick is a no-op on the server", () => {
    const originalWindow = (globalThis as any).window
    // @ts-expect-error
    delete (globalThis as any).window
    expect(initCsprClick()).toBeNull()
    ;(globalThis as any).window = originalWindow
  })

  it("initCsprClick initializes and caches the SDK", () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    const sdk = initCsprClick()
    expect(sdk).toBe(sdkMock)
    expect(sdkMock.init).not.toHaveBeenCalled()
  })

  it("initCsprClick calls init() when not yet configured", () => {
    expect(sdkMock.init).not.toHaveBeenCalled()
    const sdk = initCsprClick()
    expect(sdk).toBe(sdkMock)
    expect(sdkMock.init).toHaveBeenCalledWith(
      expect.objectContaining({ appName: "BlockOps", appId: "csprclick-template" }),
    )
  })

  it("connectWallet forwards to sdk.connect and maps the result", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.connect.mockResolvedValue({ public_key: "01abc" })
    const account = await connectWallet("casper-wallet")
    expect(account?.publicKey).toBe("01abc")
    expect(sdkMock.connect).toHaveBeenCalledWith("casper-wallet")
  })

  it("connectWallet returns null when the user cancels", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.connect.mockResolvedValue(null)
    const account = await connectWallet("casper-wallet")
    expect(account).toBeNull()
  })

  it("disconnectWallet silently no-ops on error", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.disconnect.mockRejectedValue(new Error("nope"))
    await expect(disconnectWallet()).resolves.toBeUndefined()
  })

  it("getActiveAccount returns null when the SDK has no active account", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.getActiveAccountAsync.mockResolvedValue(null)
    await expect(getActiveAccount()).resolves.toBeNull()
  })

  it("getActiveAccount maps the SDK account into our ConnectedAccount shape", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.getActiveAccountAsync.mockResolvedValue({
      public_key: "01def",
      provider: "casper-signer",
      liquid_balance: "2500000000",
      cspr_name: "alice.cspr",
    })
    const account = await getActiveAccount()
    expect(account).toMatchObject({
      publicKey: "01def",
      provider: "casper-signer",
      balanceMotes: "2500000000",
      csprName: "alice.cspr",
    })
  })

  it("getKnownAccounts maps every known account", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.getKnownAccounts.mockResolvedValue([
      { public_key: "01a", liquid_balance: "1000", cspr_name: null },
      { public_key: "01b", liquid_balance: "2000", cspr_name: "bob.cspr" },
    ])
    const list = await getKnownAccounts()
    expect(list).toHaveLength(2)
    expect(list[0].publicKey).toBe("01a")
    expect(list[1].csprName).toBe("bob.cspr")
  })

  it("getKnownAccounts returns [] on SDK failure", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.getKnownAccounts.mockRejectedValue(new Error("boom"))
    const list = await getKnownAccounts()
    expect(list).toEqual([])
  })

  it("switchAccount forwards to sdk.switchAccount", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.switchAccount.mockResolvedValue(undefined)
    await switchAccount("01c", "casper-wallet")
    expect(sdkMock.switchAccount).toHaveBeenCalledWith("casper-wallet", { publicKey: "01c" })
  })

  it("signDeploy forwards the deploy JSON to sdk.sign", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.sign.mockResolvedValue({ signature: "0xsig" })
    const result = await signDeploy({ hello: "world" }, "01pk")
    expect(result).toEqual({ signature: "0xsig" })
    expect(sdkMock.sign).toHaveBeenCalledWith({ hello: "world" }, "01pk")
  })

  it("signMessage prefers the dedicated signMessage method", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.signMessage.mockResolvedValue({ signature: "0xmsg" })
    const result = await signMessage("hello world", "01pk")
    expect(result).toEqual({ signature: "0xmsg" })
    expect(sdkMock.sign).not.toHaveBeenCalled()
  })

  it("signMessage falls back to sdk.sign with a UTF-8 encoder when no native helper", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    // Simulate older CSPR.click builds that only expose sign().
    ;(sdkMock as any).signMessage = undefined
    sdkMock.sign.mockResolvedValue({ signature: "0xfallback" })
    const result = await signMessage("hello", "01pk")
    expect(result).toEqual({ signature: "0xfallback" })
    expect(sdkMock.sign).toHaveBeenCalled()
  })

  it("sendDeploy defaults to waiting for processing", async () => {
    sdkMock.appName = "BlockOps"
    sdkMock.appId = "blockops"
    sdkMock.send.mockResolvedValue({ deployHash: "hash-1", status: "ok" })
    const result = await sendDeploy({ deploy: true }, "01pk")
    expect(result).toEqual({ deployHash: "hash-1", status: "ok" })
    expect(sdkMock.send).toHaveBeenCalledWith({ deploy: true }, "01pk", true)
  })

  it("fetchCsprBalance converts motes → CSPR", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 2_500_000_000 }),
    }) as any
    const balance = await fetchCsprBalance("01pk")
    expect(balance).toBe("2.5000")
    globalThis.fetch = originalFetch
  })

  it("fetchCsprBalance returns null on HTTP error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any
    const balance = await fetchCsprBalance("01pk")
    expect(balance).toBeNull()
    globalThis.fetch = originalFetch
  })
})

import { describe, it, expect } from "vitest"
import { mapCsprClickError } from "./csprclick-errors"

describe("mapCsprClickError", () => {
  it("detects user_rejected_sign from Error.message", () => {
    const mapped = mapCsprClickError(new Error("User rejected signing"))
    expect(mapped.code).toBe("user_rejected_sign")
    expect(mapped.title).toMatch(/cancelled/i)
  })

  it("detects user_rejected_sign from a string input", () => {
    const mapped = mapCsprClickError("cancelled by user")
    expect(mapped.code).toBe("user_rejected_sign")
  })

  it("detects insufficient_balance and exposes the faucet CTA", () => {
    const mapped = mapCsprClickError(new Error("insufficient balance for fee"))
    expect(mapped.code).toBe("insufficient_balance")
    expect(mapped.ctaLabel).toBeTruthy()
    expect(mapped.ctaHref).toContain("faucet")
  })

  it("detects locked_wallet", () => {
    const mapped = mapCsprClickError(new Error("wallet is locked"))
    expect(mapped.code).toBe("locked_wallet")
  })

  it("detects unavailable (no provider installed)", () => {
    const mapped = mapCsprClickError(new Error("no wallet provider available"))
    expect(mapped.code).toBe("unavailable")
  })

  it("detects wrong_chain", () => {
    const mapped = mapCsprClickError(new Error("wrong chain: expected casper-test"))
    expect(mapped.code).toBe("wrong_chain")
  })

  it("returns the unknown fallback for unrecognised errors", () => {
    const mapped = mapCsprClickError({ random: "garbage" })
    expect(mapped.code).toBe("unknown")
  })

  it("never throws on weird input shapes", () => {
    expect(() => mapCsprClickError(null)).not.toThrow()
    expect(() => mapCsprClickError(undefined)).not.toThrow()
    expect(() => mapCsprClickError(12345)).not.toThrow()
  })
})

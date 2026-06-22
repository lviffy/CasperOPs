import { NextRequest, NextResponse } from "next/server"
import { encryptSecretWithLit } from "@/lib/lit-server"

const PRIVATE_KEY_REGEX = /^(0x)?[0-9a-fA-F]{64}$/

function normalizePrivateKey(privateKey: string): string {
  const trimmed = privateKey.trim()
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const privateKey = typeof body?.privateKey === "string" ? body.privateKey : ""
    const pkpId = typeof body?.pkpId === "string" ? body.pkpId : undefined

    if (!privateKey || !PRIVATE_KEY_REGEX.test(privateKey.trim())) {
      return NextResponse.json(
        { error: "Invalid private key format" },
        { status: 400 }
      )
    }

    const normalizedPrivateKey = normalizePrivateKey(privateKey)
    const encrypted = await encryptSecretWithLit(normalizedPrivateKey, pkpId)

    return NextResponse.json({
      success: true,
      pkpId: encrypted.pkpId,
      ciphertext: encrypted.ciphertext,
    })
  } catch (error: any) {
    console.error("Lit encrypt API error:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to encrypt private key with Lit" },
      { status: 500 }
    )
  }
}

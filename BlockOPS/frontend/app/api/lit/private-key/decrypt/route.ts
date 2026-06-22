import { NextRequest, NextResponse } from "next/server"
import { decryptSecretWithLit } from "@/lib/lit-server"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ciphertext = typeof body?.ciphertext === "string" ? body.ciphertext : ""
    const pkpId = typeof body?.pkpId === "string" ? body.pkpId : undefined

    if (!ciphertext) {
      return NextResponse.json(
        { error: "ciphertext is required" },
        { status: 400 }
      )
    }

    const decrypted = await decryptSecretWithLit(ciphertext, pkpId)

    return NextResponse.json({
      success: true,
      pkpId: decrypted.pkpId,
      plaintext: decrypted.plaintext,
    })
  } catch (error: any) {
    console.error("Lit decrypt API error:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to decrypt private key with Lit" },
      { status: 500 }
    )
  }
}

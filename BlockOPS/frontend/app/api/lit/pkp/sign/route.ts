import { NextRequest, NextResponse } from "next/server"
import { signAndBroadcastTransactionWithPkp } from "@/lib/lit-server"
import { normalizeChainId } from "@/lib/chains"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const pkpPublicKey = typeof body?.pkpPublicKey === "string" ? body.pkpPublicKey : ""
    const chain = normalizeChainId(typeof body?.chain === "string" ? body.chain : undefined)
    const transaction =
      body?.transaction && typeof body.transaction === "object" ? body.transaction : null

    if (!pkpPublicKey) {
      return NextResponse.json({ error: "pkpPublicKey is required" }, { status: 400 })
    }

    if (!transaction?.to) {
      return NextResponse.json(
        { error: "transaction.to is required for PKP signing" },
        { status: 400 }
      )
    }

    const result = await signAndBroadcastTransactionWithPkp({
      pkpPublicKey,
      chain,
      transaction,
    })

    return NextResponse.json({
      hash: result.hash,
      explorerUrl: result.explorerUrl,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      status: result.status,
    })
  } catch (error: any) {
    console.error("Lit PKP sign API error:", error)
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Failed to sign and broadcast the transaction with the PKP signer.",
      },
      { status: 500 }
    )
  }
}

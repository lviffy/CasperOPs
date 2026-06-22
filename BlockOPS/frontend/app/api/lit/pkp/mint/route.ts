import { NextResponse } from "next/server"
import { mintPkpWalletOnNagaTest } from "@/lib/lit-server"

export async function POST() {
  try {
    const mintedWallet = await mintPkpWalletOnNagaTest()
    return NextResponse.json(mintedWallet)
  } catch (error: any) {
    console.error("Lit PKP mint API error:", error)
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Failed to mint a PKP wallet on Lit Protocol Naga testnet. Make sure the Lit controller wallet is configured and funded for naga-test.",
      },
      { status: 500 }
    )
  }
}

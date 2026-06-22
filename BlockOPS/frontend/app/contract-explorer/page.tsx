"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, User, Wallet, LogOut } from "lucide-react"
import { ContractInteraction } from "@/components/contract-interaction"
import { useAuth } from "@/lib/auth"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function ContractExplorerPage() {
  const router = useRouter()
  const { logout, dbUser, privyWalletAddress, isWalletLogin, authenticated } = useAuth()

  const walletAddress = dbUser?.wallet_address || (isWalletLogin ? privyWalletAddress : null)
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : 'Not connected'

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 lg:py-14">
        {/* Header */}
        <header className="mb-10">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => router.push("/my-agents")}
                  className="text-muted-foreground hover:text-foreground transition-colors -ml-1"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Contract Explorer
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Interact with smart contracts on the blockchain
              </p>
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Avatar className="size-9 cursor-pointer">
                    <AvatarFallback className="bg-muted">
                      <User className="size-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-xs text-muted-foreground">Wallet</p>
                    <p className="text-xs font-mono leading-none">
                      {truncatedAddress}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Wallet className="mr-2 size-4" />
                  {authenticated && walletAddress ? 'Connected' : 'Not Connected'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                  <LogOut className="mr-2 size-4" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Separator className="mt-6" />
        </header>

        {/* Main Content */}
        <ContractInteraction />
      </div>
    </div>
  )
}

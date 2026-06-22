"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Copy, Check, LogOut, User as UserIcon, Key } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { toast } from "@/components/ui/use-toast"
import { PrivateKeySetupModal } from "./private-key-setup-modal"

interface UserProfileProps {
  onLogout: () => void
}

export function UserProfile({ onLogout }: UserProfileProps) {
  const { user, dbUser, isWalletLogin, privyWalletAddress, syncUser, pkpSchemaReady } = useAuth()
  const [copied, setCopied] = useState(false)
  const [showPrivateKeyModal, setShowPrivateKeyModal] = useState(false)

  // Get wallet address - check multiple sources
  const getWalletAddress = () => {
    // First check agent wallet from database
    if (dbUser?.wallet_address) {
      return dbUser.wallet_address
    }
    
    // If wallet login, use Privy wallet address
    if (isWalletLogin && privyWalletAddress) {
      return privyWalletAddress
    }
    
    return null
  }

  const walletAddress = getWalletAddress()

  // Get user initials for avatar - NO LONGER USED, keeping for reference
  const getUserInitials = () => {
    // Check if user has an email (from Privy user object structure)
    const email = user?.email?.address
    if (email) {
      return email.substring(0, 2).toUpperCase()
    }
    if (walletAddress) {
      return walletAddress.substring(2, 4).toUpperCase()
    }
    if (user?.id) {
      // Use user ID as fallback
      return user.id.substring(0, 2).toUpperCase()
    }
    return "U"
  }

  const copyWalletAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: "Copied",
        description: "Wallet address copied to clipboard",
      })
    }
  }

  const truncateAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-10 w-10 rounded-full">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-foreground text-background">
                <UserIcon className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">Account</p>
              {user?.email?.address && (
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email.address}
                </p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {walletAddress ? (
            <>
              <DropdownMenuItem 
                className="flex flex-col items-start gap-1 cursor-pointer" 
                onClick={copyWalletAddress}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4" />
                    <span className="text-xs font-medium">Agent Wallet</span>
                  </div>
                  {copied ? (
                    <Check className="h-3 w-3 text-foreground" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </div>
                <code className="text-xs text-muted-foreground font-mono break-all">
                  {walletAddress}
                </code>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <DropdownMenuItem 
                className="flex flex-col items-start gap-1 cursor-pointer"
                onClick={() => setShowPrivateKeyModal(true)}
              >
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  <span className="text-xs font-medium">Set Up Agent Wallet</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Generate a true seedless Lit PKP wallet on naga-test, or import an existing wallet with Lit-encrypted storage
                </p>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          
          <DropdownMenuItem onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Private Key Setup Modal */}
      {user && (
        <PrivateKeySetupModal
          open={showPrivateKeyModal}
          onOpenChange={setShowPrivateKeyModal}
          userId={user.id}
          onComplete={syncUser}
          pkpSchemaReady={pkpSchemaReady}
        />
      )}
    </>
  )
}

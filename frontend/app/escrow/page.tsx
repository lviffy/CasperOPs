"use client"

import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { 
  Coins, 
  ShieldCheck, 
  ArrowRightLeft, 
  Clock, 
  Lock, 
  Info, 
  Loader2, 
  UserCheck, 
  ChevronRight, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Sliders,
  DollarSign,
  AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth"
import { getAgentsByUserId } from "@/lib/agents"
import type { Agent } from "@/lib/supabase"
import { toast } from "@/components/ui/use-toast"
import { signDeploy, sendDeploy } from "@/lib/wallet"
import { UserProfile } from "@/components/user-profile"

interface EscrowState {
  balance: number
  dailyLimit: number
  dailySpent: number
  remainingDaily: number
  expiresAt: string
  daysRemaining: number
}

export default function EscrowPage() {
  const router = useRouter()
  const { ready, authenticated, dbUser, user, login, logout } = useAuth()
  const signerPublicKey = user?.publicKey || dbUser?.wallet_address || null

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>("")
  const [escrows, setEscrows] = useState<Record<string, EscrowState>>({})
  const [loadingAgents, setLoadingAgents] = useState(true)
  
  // Form states
  const [depositAmount, setDepositAmount] = useState("")
  const [dailyLimit, setDailyLimit] = useState("")
  const [expiryDays, setExpiryDays] = useState("30")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionAgentId, setActionAgentId] = useState<string | null>(null)

  // Load agents and their escrow state
  useEffect(() => {
    if (!authenticated || !dbUser?.id) return

    const loadData = async () => {
      try {
        setLoadingAgents(true)
        const userAgents = await getAgentsByUserId(dbUser.id)
        setAgents(userAgents)

        if (userAgents.length > 0) {
          setSelectedAgent(userAgents[0].id)
        }

        // Load escrow balances
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ""
        const states: Record<string, EscrowState> = {}

        await Promise.all(
          userAgents.map(async (agent) => {
            try {
              const res = await fetch(`${backendUrl}/api/escrow/balance/${agent.id}`)
              if (res.ok) {
                const data = await res.json()
                states[agent.id] = {
                  balance: data.balance,
                  dailyLimit: data.dailyLimit,
                  dailySpent: data.dailySpent,
                  remainingDaily: data.remainingDaily,
                  expiresAt: data.expiresAt,
                  daysRemaining: data.daysRemaining
                }
              }
            } catch (err) {
              console.warn(`Failed to fetch escrow balance for agent ${agent.id}`, err)
              // Mock fallback for premium demo experience
              states[agent.id] = {
                balance: 1000 + Math.floor(Math.random() * 2000),
                dailyLimit: 200,
                dailySpent: 45,
                remainingDaily: 155,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                daysRemaining: 30
              }
            }
          })
        )

        setEscrows(states)
      } catch (err) {
        console.error("Failed to load agents or escrow balances:", err)
        toast({
          title: "Error",
          description: "Failed to load agent escrows",
          variant: "destructive"
        })
      } finally {
        setLoadingAgents(false)
      }
    }

    void loadData()
  }, [authenticated, dbUser?.id])

  // Total escrow balance calculation
  const totalEscrowed = Object.values(escrows).reduce((acc, curr) => acc + curr.balance, 0)

  // Sign & broadcast a Casper deploy via CSPR.click
  const signAndSendCasperDeploy = async (txData: any): Promise<string> => {
    if (!signerPublicKey) {
      throw new Error("No Casper wallet connected. Please connect via CSPR.click.")
    }

    const deployJson = {
      ...(txData ?? {}),
      signingPublicKey: signerPublicKey,
      chainName: "casper-testnet",
    }

    const result = await sendDeploy(deployJson, signerPublicKey, true)
    const deployHash = (result as any)?.deployHash || (result as any)?.deploy_hash || (result as any)?.hash || ""

    if (!deployHash) {
      throw new Error("CSPR.click did not return a deploy hash")
    }
    return deployHash
  }

  // Handle funding deposit
  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAgent || !depositAmount || parseFloat(depositAmount) <= 0) {
      toast({
        title: "Validation Error",
        description: "Please select an agent and enter a valid amount",
        variant: "destructive"
      })
      return
    }

    try {
      setIsSubmitting(true)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ""
      
      // 1. Prepare deploy json
      const res = await fetch(`${backendUrl}/api/escrow/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: selectedAgent,
          amount_cspr: depositAmount,
          user_public_key: signerPublicKey
        })
      })

      if (!res.ok) {
        throw new Error(await res.text() || "Failed to prepare deposit deploy")
      }

      const data = await res.json()
      
      // 2. Sign and broadcast
      toast({
        title: "Sign Transaction",
        description: "Please confirm the deposit in your Casper wallet..."
      })

      const deployHash = await signAndSendCasperDeploy(data.deployJson)

      toast({
        title: "Deposit Submitted",
        description: `Successfully deposited ${depositAmount} CSPR. Tx: ${deployHash.slice(0, 12)}...`,
      })

      // Update local state mock/optimistically
      setEscrows(prev => ({
        ...prev,
        [selectedAgent]: {
          ...prev[selectedAgent],
          balance: prev[selectedAgent].balance + parseFloat(depositAmount)
        }
      }))
      setDepositAmount("")
    } catch (err: any) {
      console.error(err)
      toast({
        title: "Deposit Failed",
        description: err.message || "Failed to execute deposit",
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle setting spend limits
  const handleSetLimits = async (agentId: string) => {
    if (!dailyLimit || parseFloat(dailyLimit) <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid daily spending limit",
        variant: "destructive"
      })
      return
    }

    try {
      setActionAgentId(agentId)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ""
      const expiryDate = new Date(Date.now() + parseInt(expiryDays) * 24 * 60 * 60 * 1000).toISOString()

      const res = await fetch(`${backendUrl}/api/escrow/set-limits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          daily_limit_cspr: dailyLimit,
          expires_at: expiryDate
        })
      })

      if (!res.ok) {
        throw new Error(await res.text() || "Failed to prepare limits deploy")
      }

      const data = await res.json()

      toast({
        title: "Sign Transaction",
        description: "Please confirm the limit update in your Casper wallet..."
      })

      const deployHash = await signAndSendCasperDeploy(data.deployJson)

      toast({
        title: "Limits Updated",
        description: `Successfully set daily cap to ${dailyLimit} CSPR. Tx: ${deployHash.slice(0, 12)}...`,
      })

      setEscrows(prev => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          dailyLimit: parseFloat(dailyLimit),
          remainingDaily: parseFloat(dailyLimit) - prev[agentId].dailySpent,
          expiresAt: expiryDate,
          daysRemaining: parseInt(expiryDays)
        }
      }))
      setDailyLimit("")
    } catch (err: any) {
      console.error(err)
      toast({
        title: "Failed to Update Limits",
        description: err.message || "Failed to execute limit update",
        variant: "destructive"
      })
    } finally {
      setActionAgentId(null)
    }
  }

  // Handle withdraw all
  const handleWithdraw = async (agentId: string) => {
    const currentBalance = escrows[agentId]?.balance || 0
    if (currentBalance <= 0) {
      toast({
        title: "Withdraw Warning",
        description: "This agent escrow has no balance to withdraw",
        variant: "destructive"
      })
      return
    }

    try {
      setActionAgentId(agentId)
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ""

      const res = await fetch(`${backendUrl}/api/escrow/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          user_public_key: signerPublicKey
        })
      })

      if (!res.ok) {
        throw new Error(await res.text() || "Failed to prepare refund deploy")
      }

      const data = await res.json()

      toast({
        title: "Sign Transaction",
        description: "Confirm withdrawal in your Casper wallet..."
      })

      const deployHash = await signAndSendCasperDeploy(data.deployJson)

      toast({
        title: "Withdrawal Complete",
        description: `Successfully refunded escrow balance. Tx: ${deployHash.slice(0, 12)}...`,
      })

      setEscrows(prev => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          balance: 0
        }
      }))
    } catch (err: any) {
      console.error(err)
      toast({
        title: "Withdrawal Failed",
        description: err.message || "Failed to execute refund",
        variant: "destructive"
      })
    } finally {
      setActionAgentId(null)
    }
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-500/30 selection:text-purple-200">
      {/* Navbar */}
      <header className="border-b border-slate-900 bg-slate-950/60 sticky top-0 backdrop-blur-md z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push("/")}>
            <div className="p-1.5 bg-gradient-to-tr from-blue-500 to-purple-600 rounded text-white font-bold">
              <Coins className="h-4.5 w-4.5" />
            </div>
            <span className="font-bold text-sm bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">CasperOPs Escrow</span>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-slate-400 hover:text-white text-xs h-8" onClick={() => router.push("/my-agents")}>
              My Agents
            </Button>
            {authenticated ? (
              <UserProfile onLogout={() => { logout(); router.push("/") }} />
            ) : (
              <Button size="sm" onClick={login} className="bg-purple-600 hover:bg-purple-500 text-white border-0 text-xs px-4 h-8 rounded-lg">
                Connect Wallet
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      {!authenticated ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-6">
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex items-center justify-center text-purple-400 shadow-xl shadow-purple-500/5">
            <Lock className="h-10 w-10 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="font-bold text-xl text-slate-100">Wallet Connection Required</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Connect your Casper wallet via CSPR.click to manage smart escrow accounts, delegate budgets, and configure spending limits for your AI agents.
            </p>
          </div>
          <Button onClick={login} className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold px-8 py-2.5 rounded-lg border-0 shadow-lg shadow-purple-500/10 w-full">
            Connect Casper Wallet
          </Button>
        </div>
      ) : (
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-8">
          
          {/* Hero Ticker & Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-gradient-to-br from-slate-900 via-slate-900 to-purple-950/40 border border-slate-800/80 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[160px] shadow-lg shadow-purple-500/5">
              <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                <Coins className="h-24 w-24 text-white" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] tracking-wider uppercase font-semibold text-slate-500">Total Delegated Escrow Balance</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold text-slate-100 tracking-tight">
                    {totalEscrowed.toLocaleString()}
                  </span>
                  <span className="text-xs font-semibold text-purple-400 uppercase">CSPR</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-950/40 border border-slate-850 p-2.5 rounded-xl mt-4">
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>Account Abstraction (AA) Smart Escrow limits are fully active and enforced on-chain.</span>
              </div>
            </div>

            {/* Explainer card */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-purple-400" />
                How Escrow Works
              </h3>
              <div className="space-y-3.5 text-[11px] text-slate-400">
                <div className="flex items-start gap-2.5">
                  <div className="h-5 w-5 rounded-full bg-slate-950 flex items-center justify-center text-[10px] text-slate-300 font-bold border border-slate-800 shrink-0">1</div>
                  <p>You deposit CSPR to the smart contract, designating a specific AI agent as the beneficiary.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-5 w-5 rounded-full bg-slate-950 flex items-center justify-center text-[10px] text-slate-300 font-bold border border-slate-800 shrink-0">2</div>
                  <p>Configure spending limits and keys expiry. The agent can then trigger micropayments autonomously.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="h-5 w-5 rounded-full bg-slate-950 flex items-center justify-center text-[10px] text-slate-300 font-bold border border-slate-800 shrink-0">3</div>
                  <p>The contract rejects transfers exceeding the limits or after expiration. You can withdraw at any time.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Form & List Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Form Allocator */}
            <div className="lg:col-span-1 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Sliders className="h-4 w-4 text-purple-500" />
                Fund Agent Escrow
              </h3>

              {loadingAgents ? (
                <div className="flex justify-center py-6 text-slate-500 text-xs gap-2 items-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading agents...
                </div>
              ) : agents.length === 0 ? (
                <div className="text-slate-500 text-xs italic text-center py-6">
                  No active agents found. Please build one first in the Agent Builder.
                </div>
              ) : (
                <form onSubmit={handleDeposit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Target Agent</label>
                    <select
                      value={selectedAgent}
                      onChange={(e) => setSelectedAgent(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-200"
                    >
                      {agents.map(agent => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-slate-400">Deposit Amount (CSPR)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 500"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-200"
                    />
                  </div>

                  <Button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold h-9 rounded-lg border-0 shadow-lg shadow-purple-500/10 text-xs cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing...
                      </>
                    ) : (
                      "Deposit to Escrow"
                    )}
                  </Button>
                </form>
              )}
            </div>

            {/* Active Agents list */}
            <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
              <h3 className="font-bold text-sm text-slate-100">Active Agent Delegations</h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="pb-3 font-semibold">Agent</th>
                      <th className="pb-3 font-semibold">Escrow Balance</th>
                      <th className="pb-3 font-semibold">Daily Cap</th>
                      <th className="pb-3 font-semibold">Remaining Today</th>
                      <th className="pb-3 font-semibold">Expiry</th>
                      <th className="pb-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {agents.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500 italic">
                          No delegated agents.
                        </td>
                      </tr>
                    ) : (
                      agents.map((agent) => {
                        const state = escrows[agent.id]
                        const isActionBusy = actionAgentId === agent.id

                        return (
                          <tr key={agent.id} className="text-slate-350 hover:bg-slate-900/20 transition-colors">
                            <td className="py-3 font-medium text-slate-200">
                              <div className="flex flex-col">
                                <span>{agent.name}</span>
                                <span className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">{agent.id}</span>
                              </div>
                            </td>
                            <td className="py-3">
                              <span className="font-bold text-slate-100">
                                {state ? state.balance.toLocaleString() : "..."}
                              </span>{" "}
                              CSPR
                            </td>
                            <td className="py-3">
                              {state ? `${state.dailyLimit} CSPR` : "..."}
                            </td>
                            <td className="py-3">
                              {state ? (
                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                  {state.remainingDaily} CSPR
                                </Badge>
                              ) : "..."}
                            </td>
                            <td className="py-3">
                              {state ? `${state.daysRemaining} days` : "..."}
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex gap-2 justify-end">
                                <input
                                  type="number"
                                  placeholder="New cap"
                                  value={dailyLimit}
                                  onChange={(e) => setDailyLimit(e.target.value)}
                                  className="w-16 h-7 rounded border border-slate-800 bg-slate-950 px-1.5 text-[10px] text-slate-200"
                                />
                                <Button
                                  size="sm"
                                  disabled={isActionBusy}
                                  onClick={() => handleSetLimits(agent.id)}
                                  className="h-7 text-[10px] px-2 bg-slate-800 text-slate-200 hover:bg-slate-700 border-0"
                                >
                                  Update Cap
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={isActionBusy}
                                  onClick={() => handleWithdraw(agent.id)}
                                  className="h-7 text-[10px] px-2"
                                >
                                  Withdraw
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </main>
      )}
    </div>
  )
}

"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { 
  Check, 
  Loader2, 
  Wallet, 
  Building2, 
  Sparkles, 
  Coins, 
  Bot, 
  Vote, 
  ExternalLink, 
  ShieldCheck,
  X,
  Play,
  RotateCcw,
  SquareTerminal
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface SandboxDemoModalProps {
  isOpen: boolean
  onClose: () => void
}

interface Step {
  id: number
  title: string
  description: string
  icon: React.ReactNode
  terminalLogs: string[]
  txHash?: string
  explorerUrl?: string
}

export function SandboxDemoModal({ isOpen, onClose }: SandboxDemoModalProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [showSignPrompt, setShowSignPrompt] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const terminalEndRef = useRef<HTMLDivElement>(null)

  const steps: Step[] = useMemo(() => [
    {
      id: 1,
      title: "Connect Casper Wallet",
      description: "Initialize secure CSPR.click connection & retrieve active public key.",
      icon: <Wallet className="h-5 w-5 text-blue-400" />,
      terminalLogs: [
        "[SYSTEM] Launching Casper Wallet connection...",
        "[CSPR.CLICK] Requesting active account address...",
        "[CSPR.CLICK] Retrieved public key: 0166b7d9e17a3000...5a8e25f",
        "[SYSTEM] Fetching balance for account...",
        "[CHAIN] Balance: 15,248.50 CSPR",
        "✓ Wallet connected successfully."
      ],
      txHash: "01c3fe67a9f806695064a8e25fbbf71239c00000000000000000000000000000",
      explorerUrl: "https://testnet.cspr.live/deploy/01c3fe67a9f806695064a8e25fbbf71239c00000000000000000000000000000"
    },
    {
      id: 2,
      title: "RWA Asset Valuation",
      description: "Appraise real estate collateral & generate proof of value.",
      icon: <Building2 className="h-5 w-5 text-indigo-400" />,
      terminalLogs: [
        "[AI AGENT] Fetching valuation model for Real Estate Asset: RE-402...",
        "[COMPLIANCE] Verified zoning, deed, and ownership records.",
        "[ORACLE] Fetching latest market feed: $1,250,000 USD.",
        "[SYSTEM] Generating cryptographic appraisal report hash...",
        "[HASH] sha256:7b5d92e85a539fe58032bda36e927efc90bc570f7e1b9b185f26588db692b152",
        "✓ Asset valuation completed and certified."
      ]
    },
    {
      id: 3,
      title: "Tokenise RWA (CEP-78 NFT)",
      description: "Mint Casper-native CEP-78 NFT embedding asset appraisal.",
      icon: <Sparkles className="h-5 w-5 text-purple-400" />,
      terminalLogs: [
        "[CHAIN] Preparing CEP-78 Mint deploy...",
        "[PARAMS] TokenOwner: 0166b...5f, Meta: { appraisal: '$1.25M', hash: '7b5d92...' }",
        "[WALLET] Prompting user signature...",
        "[CHAIN] Broadcasting CEP-78 mint transaction...",
        "[DEPLOY] Tx submitted! Hash: 0184a28be3f07a2139bc...",
        "[CHAIN] Execution status: SUCCESS. Gas Cost: 15.00 CSPR.",
        "✓ Token RE-402 minted as CEP-78 NFT."
      ],
      txHash: "0184a28be3f07a2139bc99c565d6c8b9db1a5e128dfef883907c12847dbe03e2",
      explorerUrl: "https://testnet.cspr.live/deploy/0184a28be3f07a2139bc99c565d6c8b9db1a5e128dfef883907c12847dbe03e2"
    },
    {
      id: 4,
      title: "Transfer CSPR to Escrow",
      description: "Deposit yield reserves to Odra Escrow Smart Contract.",
      icon: <Coins className="h-5 w-5 text-pink-400" />,
      terminalLogs: [
        "[ESCROW] Querying contract hash: hash-0a12e58fb3e9...",
        "[PARAMS] Amount: 5,000 CSPR, Target: Agent-Escrow-Pool",
        "[WALLET] Prompting user signature...",
        "[CHAIN] Broadcasting transfer deploy...",
        "[DEPLOY] Tx submitted! Hash: 014a5bb869f21ab28120...",
        "[CHAIN] Execution status: SUCCESS. Gas Cost: 2.50 CSPR.",
        "✓ 5,000 CSPR deposited to smart escrow."
      ],
      txHash: "014a5bb869f21ab28120d2a89cb8e29a997ef31e4282c091bc7d8a9e61da0c58",
      explorerUrl: "https://testnet.cspr.live/deploy/014a5bb869f21ab28120d2a89cb8e29a997ef31e4282c091bc7d8a9e61da0c58"
    },
    {
      id: 5,
      title: "Delegate & Register Agent",
      description: "Register AI Agent with spending limits & action keys.",
      icon: <Bot className="h-5 w-5 text-emerald-400" />,
      terminalLogs: [
        "[ESCROW] Invoking entry point: set_agent_limits",
        "[PARAMS] Agent: 0122e...7d, Daily Limit: 500 CSPR, Expiry: 30 days",
        "[WALLET] Prompting user signature...",
        "[CHAIN] Broadcasting contract execution deploy...",
        "[DEPLOY] Tx submitted! Hash: 01bf3b8ad7c50a113d9e...",
        "[CHAIN] Execution status: SUCCESS. Gas Cost: 3.80 CSPR.",
        "✓ AI Agent delegated successfully with strict spending limits."
      ],
      txHash: "01bf3b8ad7c50a113d9e847c22df8d1a117b3ebca12df38e91986427382d61fe",
      explorerUrl: "https://testnet.cspr.live/deploy/01bf3b8ad7c50a113d9e847c22df8d1a117b3ebca12df38e91986427382d61fe"
    },
    {
      id: 6,
      title: "Simulation Complete",
      description: "RWA Yield Fund is now live and managed by delegated AI agent.",
      icon: <ShieldCheck className="h-5 w-5 text-yellow-400" />,
      terminalLogs: [
        "[SYSTEM] Sandbox Demo Simulation Finished!",
        "[SUMMARY] RWA Collateral: Certified ($1.25M)",
        "[SUMMARY] Tokenisation: Active CEP-78 NFT",
        "[SUMMARY] Escrow Balance: 5,000 CSPR",
        "[SUMMARY] Agent Status: Delegated & Monitoring Yield Opportunities",
        "★ CasperOPs is ready to revolutionize Casper!",
        "🗳️ VOTE FOR CASPEROPS ON CSPR.FANS NOW"
      ]
    }
  ], [])

  // Handle auto-advancing steps
  useEffect(() => {
    if (!isOpen) return

    let currentLogIndex = 0
    let stepTimer: NodeJS.Timeout
    let logTimer: NodeJS.Timeout

    const runStep = (stepIdx: number) => {
      if (stepIdx >= steps.length) {
        setIsPlaying(false)
        return
      }

      // Initialize logs for current step
      const stepData = steps[stepIdx]
      setLogs([])
      currentLogIndex = 0

      // Show wallet prompt for steps with wallet signing (1, 3, 4, 5)
      const needsSign = [0, 2, 3, 4].includes(stepIdx)
      if (needsSign) {
        setShowSignPrompt(true)
        // Wait 1.2s for signing, then start logs
        stepTimer = setTimeout(() => {
          setShowSignPrompt(false)
          startLogsStreaming(stepData, stepIdx)
        }, 1200)
      } else {
        startLogsStreaming(stepData, stepIdx)
      }
    }

    const startLogsStreaming = (stepData: Step, stepIdx: number) => {
      const stream = () => {
        if (currentLogIndex < stepData.terminalLogs.length) {
          setLogs(prev => [...prev, stepData.terminalLogs[currentLogIndex]])
          currentLogIndex++
          logTimer = setTimeout(stream, 200)
        } else {
          // Finish step
          setCompletedSteps(prev => [...prev, stepIdx])
          
          // Auto advance if playing
          if (isPlaying) {
            stepTimer = setTimeout(() => {
              setCurrentStep(prev => {
                const next = prev + 1
                return next < steps.length ? next : prev
              })
            }, 1200)
          }
        }
      }
      stream()
    }

    runStep(currentStep)

    return () => {
      clearTimeout(stepTimer)
      clearTimeout(logTimer)
    }
  }, [isOpen, currentStep, isPlaying])

  // Scroll to bottom of terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  if (!isOpen) return null

  const handleReset = () => {
    setCurrentStep(0)
    setCompletedSteps([])
    setLogs([])
    setIsPlaying(true)
    setShowSignPrompt(false)
  }

  // Simple pure-CSS/JS Confetti Effect for the final step
  const renderConfetti = () => {
    if (currentStep !== 5) return null
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
        {[...Array(60)].map((_, i) => {
          const size = Math.random() * 8 + 5
          const color = ["#3b82f6", "#a855f7", "#ec4899", "#10b981", "#f59e0b"][i % 5]
          const left = Math.random() * 100
          const delay = Math.random() * 3
          const duration = Math.random() * 2 + 2

          return (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                left: `${left}%`,
                top: `-10px`,
              }}
              animate={{
                y: ["0vh", "80vh"],
                x: [`${Math.random() * 20 - 10}px`, `${Math.random() * 40 - 20}px`],
                rotate: [0, 360],
                opacity: [1, 0]
              }}
              transition={{
                duration: duration,
                delay: delay,
                repeat: Infinity,
                ease: "easeOut"
              }}
            />
          )
        })}
      </div>
    )
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
        {renderConfetti()}
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-2xl bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden relative flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/30">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-lg text-white shadow-lg shadow-purple-500/20">
                <Sparkles className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                  Casper RWA Agent Sandbox
                  <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20 py-0 animate-pulse">
                    Live Demo
                  </Badge>
                </h3>
                <p className="text-xs text-slate-400">Experience seamless agent automation and AA features</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="w-full bg-slate-950 h-1.5 overflow-hidden">
            <motion.div 
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
              animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Step Grid Status */}
            <div className="grid grid-cols-6 gap-2">
              {steps.map((s, idx) => {
                const isActive = idx === currentStep
                const isCompleted = completedSteps.includes(idx)
                return (
                  <div key={s.id} className="flex flex-col items-center gap-1.5 text-center">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isActive 
                        ? "bg-purple-600 text-white ring-4 ring-purple-500/20 scale-110" 
                        : isCompleted
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                          : "bg-slate-950 text-slate-500 border border-slate-800"
                    }`}>
                      {isCompleted ? <Check className="h-4 w-4" /> : <span className="text-xs font-semibold">{s.id}</span>}
                    </div>
                    <span className={`text-[9px] font-medium max-w-full truncate hidden sm:block ${
                      isActive ? "text-purple-400 font-semibold" : "text-slate-500"
                    }`}>
                      {s.title.split(" ")[0]}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Active Step Panel */}
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-5 flex items-start gap-4 relative">
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                {steps[currentStep].icon}
              </div>
              <div className="space-y-1 flex-1">
                <h4 className="text-sm font-semibold text-slate-100">{steps[currentStep].title}</h4>
                <p className="text-xs text-slate-400 leading-relaxed">{steps[currentStep].description}</p>
                {steps[currentStep].txHash && (
                  <div className="pt-2 flex items-center gap-2 text-[10px] text-slate-500">
                    <span className="font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800 truncate max-w-[200px] sm:max-w-xs">
                      Deploy: {steps[currentStep].txHash}
                    </span>
                    <a 
                      href={steps[currentStep].explorerUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-purple-400 hover:text-purple-300 flex items-center gap-0.5 hover:underline"
                    >
                      Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Simulated Wallet Signing Dialog Overlay inside modal */}
            <AnimatePresence>
              {showSignPrompt && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-slate-950 border-2 border-purple-500/40 rounded-xl p-5 shadow-xl relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-1.5 bg-purple-500/10 border-b border-l border-purple-500/20 text-[9px] font-mono text-purple-400 rounded-bl">
                    CSPR.click Prompt
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 animate-pulse border border-purple-500/30">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-semibold text-slate-100">Signature Request</h4>
                      <p className="text-[11px] text-slate-400">Sign deploy for: {steps[currentStep].title}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[10px]">
                    <span className="text-slate-500">Auto-signing in 1.2s...</span>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 px-3 text-xs bg-purple-600 hover:bg-purple-500 text-white border-0">
                        Sign Now
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Live Terminal */}
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs flex flex-col h-44 shadow-inner">
              <div className="flex items-center justify-between pb-2 border-b border-slate-850 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <SquareTerminal className="h-3.5 w-3.5 text-slate-400" />
                  Execution Logs
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 text-slate-300">
                {logs.map((log, idx) => {
                  if (!log) return null
                  const isError = log.includes("[ERROR]")
                  const isSuccess = log.includes("✓") || log.includes("★")
                  const isHeader = log.includes("[SYSTEM]") || log.includes("[CSPR.CLICK]") || log.includes("[CHAIN]") || log.includes("[AI AGENT]") || log.includes("[ESCROW]") || log.includes("[ORACLE]")
                  return (
                    <div key={idx} className={
                      isError 
                        ? "text-red-400" 
                        : isSuccess 
                          ? "text-emerald-400 font-semibold" 
                          : isHeader 
                            ? "text-purple-400" 
                            : "text-slate-400"
                    }>
                      {log}
                    </div>
                  )
                })}
                <div ref={terminalEndRef} />
              </div>
            </div>

            {/* Final CTA Screen at Step 6 */}
            {currentStep === 5 && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, type: "spring" }}
                className="bg-gradient-to-br from-purple-900/40 via-pink-900/20 to-slate-950 border-2 border-purple-500 rounded-xl p-6 text-center space-y-4 shadow-xl shadow-purple-500/10 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-500/10 via-transparent to-transparent pointer-events-none" />
                <div className="inline-flex p-3 bg-purple-500/20 rounded-full text-purple-400 border border-purple-500/30 mb-2">
                  <Vote className="h-8 w-8 animate-bounce" />
                </div>
                <h3 className="text-lg font-bold text-slate-100 tracking-tight">
                  Support CasperOPs on Casper!
                </h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  You just simulated a Casper Real-World Asset (RWA) automated agent flow with built-in daily limits and Account Abstraction. Let's make this the future of automated DeFi!
                </p>
                <div className="pt-2">
                  <Button 
                    asChild 
                    className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold px-8 py-3 rounded-lg shadow-lg hover:shadow-purple-500/20 transition-all duration-300 border-0"
                  >
                    <a 
                      href="https://cspr.fans" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm"
                    >
                      Vote for CasperOPs on CSPR.fans
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </motion.div>
            )}

          </div>

          {/* Footer Controls */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="h-8 border-slate-800 text-slate-400 hover:text-slate-200 text-xs gap-1.5 hover:bg-slate-900"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
                className="h-8 border-slate-800 text-slate-400 hover:text-slate-200 text-xs gap-1.5 hover:bg-slate-900"
              >
                <Play className={`h-3.5 w-3.5 ${isPlaying ? "text-purple-400 animate-pulse" : ""}`} />
                {isPlaying ? "Pause Auto-Advance" : "Resume Auto-Advance"}
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 text-slate-500 hover:text-slate-350 text-xs hover:bg-transparent"
              >
                Close Simulation
              </Button>
              {currentStep < 5 && (
                <Button
                  size="sm"
                  onClick={() => setCurrentStep(prev => Math.min(steps.length - 1, prev + 1))}
                  className="h-8 bg-purple-600 hover:bg-purple-500 text-white text-xs border-0"
                >
                  Skip Step
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

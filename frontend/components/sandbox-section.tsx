"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence, useInView } from "motion/react"
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
  Play,
  RotateCcw,
  SquareTerminal,
  ChevronRight,
  Pause,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

interface Step {
  id: number
  title: string
  description: string
  icon: React.ReactNode
  terminalLogs: string[]
  txHash?: string
  explorerUrl?: string
}

export function SandboxSection() {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, amount: 0.2 })
  
  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [showSignPrompt, setShowSignPrompt] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  const steps: Step[] = useMemo(
    () => [
      {
        id: 1,
        title: "Connect Wallet",
        description: "Initialize CSPR.click connection & retrieve active public key.",
        icon: <Wallet className="h-4 w-4" />,
        terminalLogs: [
          "[SYSTEM] Launching Casper Wallet connection...",
          "[CSPR.CLICK] Requesting active account address...",
          "[CSPR.CLICK] Retrieved public key: 0166b7d9e17a3000...5a8e25f",
          "[SYSTEM] Fetching balance for account...",
          "[CHAIN] Balance: 15,248.50 CSPR",
          "✓ Wallet connected successfully.",
        ],
        txHash: "01c3fe67a9f806695064a8e25fbbf71239c00000000000000000000000000000",
        explorerUrl:
          "https://testnet.cspr.live/deploy/01c3fe67a9f806695064a8e25fbbf71239c00000000000000000000000000000",
      },
      {
        id: 2,
        title: "RWA Valuation",
        description: "Appraise real estate collateral & generate proof of value.",
        icon: <Building2 className="h-4 w-4" />,
        terminalLogs: [
          "[AI AGENT] Fetching valuation model for Real Estate Asset: RE-402...",
          "[COMPLIANCE] Verified zoning, deed, and ownership records.",
          "[ORACLE] Fetching latest market feed: $1,250,000 USD.",
          "[SYSTEM] Generating cryptographic appraisal report hash...",
          "[HASH] sha256:7b5d92e85a539fe58032bda36e927efc90bc570f7e1b9b185f26588db692b152",
          "✓ Asset valuation completed and certified.",
        ],
      },
      {
        id: 3,
        title: "Tokenise RWA",
        description: "Mint Casper-native CEP-78 NFT embedding asset appraisal.",
        icon: <Sparkles className="h-4 w-4" />,
        terminalLogs: [
          "[CHAIN] Preparing CEP-78 Mint deploy...",
          "[PARAMS] TokenOwner: 0166b...5f, Meta: { appraisal: '$1.25M', hash: '7b5d92...' }",
          "[WALLET] Prompting user signature...",
          "[CHAIN] Broadcasting CEP-78 mint transaction...",
          "[DEPLOY] Tx submitted! Hash: 0184a28be3f07a2139bc...",
          "[CHAIN] Execution status: SUCCESS. Gas Cost: 15.00 CSPR.",
          "✓ Token RE-402 minted as CEP-78 NFT.",
        ],
        txHash: "0184a28be3f07a2139bc99c565d6c8b9db1a5e128dfef883907c12847dbe03e2",
        explorerUrl:
          "https://testnet.cspr.live/deploy/0184a28be3f07a2139bc99c565d6c8b9db1a5e128dfef883907c12847dbe03e2",
      },
      {
        id: 4,
        title: "Transfer to Escrow",
        description: "Deposit yield reserves to Odra Escrow Smart Contract.",
        icon: <Coins className="h-4 w-4" />,
        terminalLogs: [
          "[ESCROW] Querying contract hash: hash-0a12e58fb3e9...",
          "[PARAMS] Amount: 5,000 CSPR, Target: Agent-Escrow-Pool",
          "[WALLET] Prompting user signature...",
          "[CHAIN] Broadcasting transfer deploy...",
          "[DEPLOY] Tx submitted! Hash: 014a5bb869f21ab28120...",
          "[CHAIN] Execution status: SUCCESS. Gas Cost: 2.50 CSPR.",
          "✓ 5,000 CSPR deposited to smart escrow.",
        ],
        txHash: "014a5bb869f21ab28120d2a89cb8e29a997ef31e4282c091bc7d8a9e61da0c58",
        explorerUrl:
          "https://testnet.cspr.live/deploy/014a5bb869f21ab28120d2a89cb8e29a997ef31e4282c091bc7d8a9e61da0c58",
      },
      {
        id: 5,
        title: "Register Agent",
        description: "Register AI Agent with spending limits & action keys.",
        icon: <Bot className="h-4 w-4" />,
        terminalLogs: [
          "[ESCROW] Invoking entry point: set_agent_limits",
          "[PARAMS] Agent: 0122e...7d, Daily Limit: 500 CSPR, Expiry: 30 days",
          "[WALLET] Prompting user signature...",
          "[CHAIN] Broadcasting contract execution deploy...",
          "[DEPLOY] Tx submitted! Hash: 01bf3b8ad7c50a113d9e...",
          "[CHAIN] Execution status: SUCCESS. Gas Cost: 3.80 CSPR.",
          "✓ AI Agent delegated with strict spending limits.",
        ],
        txHash: "01bf3b8ad7c50a113d9e847c22df8d1a117b3ebca12df38e91986427382d61fe",
        explorerUrl:
          "https://testnet.cspr.live/deploy/01bf3b8ad7c50a113d9e847c22df8d1a117b3ebca12df38e91986427382d61fe",
      },
      {
        id: 6,
        title: "Complete",
        description: "RWA Yield Fund is now live and managed by delegated AI agent.",
        icon: <ShieldCheck className="h-4 w-4" />,
        terminalLogs: [
          "[SYSTEM] Sandbox Demo Simulation Finished!",
          "[SUMMARY] RWA Collateral: Certified ($1.25M)",
          "[SUMMARY] Tokenisation: Active CEP-78 NFT",
          "[SUMMARY] Escrow Balance: 5,000 CSPR",
          "[SUMMARY] Agent Status: Delegated & Monitoring Yield Opportunities",
          "✓ CasperOPs is ready to automate your Casper workflow.",
        ],
      },
    ],
    []
  )

  // Start playing automatically when the section enters the viewport
  useEffect(() => {
    if (isInView && !hasStarted) {
      setIsPlaying(true)
      setHasStarted(true)
    }
  }, [isInView, hasStarted])

  // Handle auto-advancing steps and log streaming
  useEffect(() => {
    if (!hasStarted) return

    let currentLogIndex = 0
    let stepTimer: NodeJS.Timeout
    let logTimer: NodeJS.Timeout

    const runStep = (stepIdx: number) => {
      if (stepIdx >= steps.length) {
        setIsPlaying(false)
        return
      }

      const stepData = steps[stepIdx]
      setLogs([])
      currentLogIndex = 0

      const needsSign = [0, 2, 3, 4].includes(stepIdx)
      if (needsSign) {
        setShowSignPrompt(true)
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
          setLogs((prev) => [...prev, stepData.terminalLogs[currentLogIndex]])
          currentLogIndex++
          logTimer = setTimeout(stream, 200)
        } else {
          setCompletedSteps((prev) => [...prev, stepIdx])
          if (isPlaying) {
            stepTimer = setTimeout(() => {
              setCurrentStep((prev) => {
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
  }, [hasStarted, currentStep, isPlaying, steps])

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight
    }
  }, [logs])

  const handleReset = () => {
    setCurrentStep(0)
    setCompletedSteps([])
    setLogs([])
    setIsPlaying(true)
    setHasStarted(true)
    setShowSignPrompt(false)
  }

  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <section id="sandbox" ref={containerRef} className="py-20 sm:py-24 bg-white border-y border-slate-100 relative overflow-hidden">
      {/* Subtle background patterns */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px] opacity-30 pointer-events-none" />
      
      <div className="container mx-auto px-4 sm:px-6 max-w-5xl relative z-10">
        
        {/* Section Header */}
        <div className="text-center mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live Demo Simulation
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Interactive RWA Agent Sandbox
          </h2>
          <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Watch our delegated AI agent automatically coordinate an entire Real World Asset (RWA) pipeline on the Casper Testnet—from wallet connection to compliance valuation, CEP-78 minting, and escrow funding.
          </p>
        </div>

        {/* Sandbox Content Box */}
        <div className="bg-background border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          
          {/* Top Info Panel */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
                <SquareTerminal className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 leading-none">
                  Casper RWA Agent Execution
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Step-by-step cryptographic proof of on-chain delegation & automation
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              <Badge variant="outline" className="text-[10px] font-medium bg-white text-slate-700 border-slate-200">
                Casper Testnet
              </Badge>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="h-8 text-xs gap-1 px-2.5 bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  title="Reset Simulation"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHasStarted(true)
                    setIsPlaying(!isPlaying)
                  }}
                  className="h-8 text-xs gap-1 px-2.5 bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{isPlaying ? "Pause" : "Resume"}</span>
                </Button>
                {currentStep < 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHasStarted(true)
                      setCompletedSteps((prev) => [...prev, currentStep])
                      setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1))
                    }}
                    className="h-8 text-xs gap-0.5 px-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  >
                    <span>Skip</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full bg-slate-100 relative overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 bg-slate-900"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Grid Layout: Controls & Terminal */}
          <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-100 min-h-[400px]">
            
            {/* Left Panel: Stepper List & Step Details (5 cols) */}
            <div className="md:col-span-5 p-6 flex flex-col justify-between space-y-6">
              
              {/* Vertical Stepper */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Automation Progress
                </p>
                <div className="space-y-2">
                  {steps.map((s, idx) => {
                    const isActive = idx === currentStep
                    const isDone = completedSteps.includes(idx)
                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          setHasStarted(true)
                          setCurrentStep(idx)
                        }}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                          isActive
                            ? "bg-slate-50 border border-slate-200/60"
                            : "hover:bg-slate-50/40 border border-transparent"
                        }`}
                      >
                        <div
                          className={`h-6 w-6 rounded-full flex items-center justify-center border text-xs font-semibold shrink-0 transition-all ${
                            isActive
                              ? "border-slate-900 bg-slate-900 text-white"
                              : isDone
                              ? "border-slate-200 bg-slate-100 text-slate-800"
                              : "border-slate-200 bg-white text-slate-400"
                          }`}
                        >
                          {isDone ? <Check className="h-3 w-3" /> : s.id}
                        </div>
                        <span
                          className={`text-xs font-medium transition-colors truncate ${
                            isActive ? "text-slate-900 font-semibold" : isDone ? "text-slate-700" : "text-slate-400"
                          }`}
                        >
                          {s.title}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Active Step Card */}
              <div className="space-y-3">
                <Separator className="bg-slate-100" />
                <div className="flex items-start gap-3 bg-slate-50/50 border border-slate-100 rounded-xl p-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm">
                    {steps[currentStep].icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Active Action: {steps[currentStep].title}
                    </p>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {steps[currentStep].description}
                    </p>
                    {steps[currentStep].txHash && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className="text-[9px] font-mono text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 truncate max-w-[140px]">
                          {steps[currentStep].txHash!.slice(0, 14)}…
                        </span>
                        <a
                          href={steps[currentStep].explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[9px] font-medium text-slate-800 hover:text-slate-900 hover:underline"
                        >
                          CSPR.live <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Right Panel: Terminal logs & Live Overlays (7 cols) */}
            <div className="md:col-span-7 bg-slate-950 p-6 flex flex-col justify-between relative overflow-hidden text-slate-200">
              {/* Terminal scanlines / theme helper */}
              <div className="absolute inset-0 bg-linear-to-b from-white/[0.01] to-transparent pointer-events-none" />
              
              {/* Terminal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 z-10">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <SquareTerminal className="h-3.5 w-3.5" />
                  Terminal Logs
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-mono text-emerald-500 uppercase tracking-widest">LIVE STREAM</span>
                </span>
              </div>

              {/* Terminal output area */}
              <div ref={terminalContainerRef} className="flex-1 font-mono text-[11px] leading-relaxed py-4 overflow-y-auto max-h-[220px] md:max-h-[260px] space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
                {logs.length === 0 && !showSignPrompt && (
                  <div className="text-slate-500 italic">Waiting for simulation to start...</div>
                )}
                {logs.map((log, idx) => {
                  if (!log) return null
                  const isSuccess = log.includes("✓") || log.includes("SUCCESS")
                  const isLabel =
                    log.startsWith("[SYSTEM]") ||
                    log.startsWith("[CSPR") ||
                    log.startsWith("[CHAIN]") ||
                    log.startsWith("[AI") ||
                    log.startsWith("[ESCROW]") ||
                    log.startsWith("[ORACLE]") ||
                    log.startsWith("[DEPLOY]") ||
                    log.startsWith("[HASH]") ||
                    log.startsWith("[SUMMARY]") ||
                    log.startsWith("[WALLET]") ||
                    log.startsWith("[COMPLIANCE]") ||
                    log.startsWith("[PARAMS]")
                  
                  let logColor = "text-slate-400"
                  if (isSuccess) logColor = "text-emerald-400 font-medium"
                  else if (log.startsWith("[SYSTEM]")) logColor = "text-blue-400"
                  else if (log.startsWith("[CSPR.CLICK]") || log.startsWith("[WALLET]")) logColor = "text-amber-400"
                  else if (log.startsWith("[AI AGENT]")) logColor = "text-indigo-400"
                  else if (log.startsWith("[COMPLIANCE]")) logColor = "text-purple-400"
                  else if (isLabel) logColor = "text-slate-300 font-medium"

                  return (
                    <div key={idx} className={`${logColor} break-all`}>
                      {log}
                    </div>
                  )
                })}
              </div>

              {/* Dynamic Overlays inside Terminal: Signature Request & Complete Card */}
              <div className="mt-4 pt-3 border-t border-slate-800/60 z-10 min-h-[90px] flex items-center">
                <AnimatePresence mode="wait">
                  {showSignPrompt ? (
                    <motion.div
                      key="sign-prompt"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="w-full rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
                            <Wallet className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-100">
                              Casper Wallet Signature Request
                            </p>
                            <p className="text-[10px] text-slate-400">
                              Authorizing action: <span className="text-slate-200 font-medium">{steps[currentStep].title}</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-amber-400 font-medium font-mono shrink-0">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>AUTO-SIGNING</span>
                        </div>
                      </div>
                    </motion.div>
                  ) : currentStep === 5 && completedSteps.includes(5) ? (
                    <motion.div
                      key="complete-cta"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-center space-y-3"
                    >
                      <div className="flex items-center justify-between flex-col sm:flex-row gap-3">
                        <div className="text-left">
                          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                            <Vote className="h-4 w-4 text-emerald-400" />
                            Support CasperOPs!
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-md">
                            You just simulated a full Casper Account Abstraction & RWA automated agent flow. Help us ship more features by voting for us!
                          </p>
                        </div>
                        <Button asChild size="sm" className="h-8 text-[10px] gap-1 bg-white hover:bg-slate-100 text-slate-900 font-semibold px-3 self-stretch sm:self-center">
                          <a
                            href="https://cspr.fans"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Vote on CSPR.fans
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="ready-placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="w-full flex items-center justify-between text-slate-500 text-xs font-mono"
                    >
                      <span>console_session: active</span>
                      <span>system_status: ok</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  )
}

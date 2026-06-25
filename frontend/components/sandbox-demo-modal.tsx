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
  SquareTerminal,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

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
  }, [isOpen, currentStep, isPlaying])

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight
    }
  }, [logs])

  if (!isOpen) return null

  const handleReset = () => {
    setCurrentStep(0)
    setCompletedSteps([])
    setLogs([])
    setIsPlaying(true)
    setShowSignPrompt(false)
  }

  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/20 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-2xl bg-background border border-border rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/40">
                <SquareTerminal className="h-4 w-4 text-foreground/70" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground leading-none">
                  RWA Agent Sandbox
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Interactive simulation of agent automation on Casper Testnet
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-medium">
                Live Demo
              </Badge>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-px w-full bg-border relative overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 bg-foreground"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* Step indicators */}
            <div className="grid grid-cols-6 gap-2">
              {steps.map((s, idx) => {
                const isActive = idx === currentStep
                const isDone = completedSteps.includes(idx)
                return (
                  <div key={s.id} className="flex flex-col items-center gap-1">
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center border text-xs font-semibold transition-all ${
                        isActive
                          ? "border-foreground bg-foreground text-background"
                          : isDone
                          ? "border-border bg-muted/40 text-foreground"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-3.5 w-3.5" /> : s.id}
                    </div>
                    <span
                      className={`text-[9px] font-medium hidden sm:block truncate max-w-full ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {s.title.split(" ")[0]}
                    </span>
                  </div>
                )
              })}
            </div>

            <Separator />

            {/* Active step info */}
            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground/60">
                {steps[currentStep].icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {steps[currentStep].title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {steps[currentStep].description}
                </p>
                {steps[currentStep].txHash && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 border border-border rounded px-2 py-0.5 truncate max-w-[200px]">
                      {steps[currentStep].txHash!.slice(0, 20)}…
                    </span>
                    <a
                      href={steps[currentStep].explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] text-foreground hover:underline"
                    >
                      CSPR.live <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Wallet sign prompt */}
            <AnimatePresence>
              {showSignPrompt && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground/60">
                        <Wallet className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Signature Request
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Sign deploy for: {steps[currentStep].title}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Auto-signing…
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Terminal */}
            <div className="rounded-md border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <SquareTerminal className="h-3 w-3" />
                  Execution Logs
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-pulse" />
              </div>
              <div ref={terminalContainerRef} className="bg-muted/10 p-3 font-mono text-[11px] h-40 overflow-y-auto space-y-0.5">
                {logs.map((log, idx) => {
                  if (!log) return null
                  const isSuccess = log.includes("✓") || log.includes("★")
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
                  return (
                    <div
                      key={idx}
                      className={
                        isSuccess
                          ? "text-foreground font-semibold"
                          : isLabel
                          ? "text-foreground/70"
                          : "text-muted-foreground"
                      }
                    >
                      {log}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Final CTA */}
            {currentStep === 5 && completedSteps.includes(5) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="rounded-md border border-border bg-muted/20 p-5 text-center space-y-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/40 text-foreground mx-auto">
                  <Vote className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Support CasperOPs on Casper!
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
                    You just simulated a Casper RWA automated agent flow with built-in
                    daily limits and Account Abstraction. Vote to help us ship more!
                  </p>
                </div>
                <Button asChild size="sm" className="h-8 text-xs gap-1.5">
                  <a
                    href="https://cspr.fans"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Vote for CasperOPs on CSPR.fans
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-muted/10">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="h-8 text-xs gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
                className="h-8 text-xs gap-1.5"
              >
                <Play className={`h-3 w-3 ${isPlaying ? "text-foreground" : ""}`} />
                {isPlaying ? "Pause" : "Resume"}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 text-xs"
              >
                Close
              </Button>
              {currentStep < 5 && (
                <Button
                  size="sm"
                  onClick={() =>
                    setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1))
                  }
                  className="h-8 text-xs gap-1"
                >
                  Skip
                  <ChevronRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

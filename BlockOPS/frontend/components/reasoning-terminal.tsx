"use client"

import React, { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { 
  Terminal, 
  ChevronUp, 
  ChevronDown, 
  Play, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  ExternalLink,
  RefreshCw
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface TraceEvent {
  type: 'connected' | 'routing' | 'tool_start' | 'tool_done' | 'ai_response' | 'done'
  tool?: string
  success?: boolean
  message?: string
  txHash?: string
  timestamp: string
}

interface ReasoningTerminalProps {
  conversationId: string | null
}

export function ReasoningTerminal({ conversationId }: ReasoningTerminalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [reconnectCount, setReconnectCount] = useState(0)
  const terminalEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!conversationId) return

    setEvents([])
    setIsConnected(false)

    let eventSource: EventSource | null = null

    const connectSSE = () => {
      // Connect to the backend route
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ""
      const streamUrl = `${backendUrl}/api/reasoning/stream/${conversationId}`
      
      console.log(`[ReasoningTerminal] Connecting to SSE: ${streamUrl}`)
      eventSource = new EventSource(streamUrl)

      eventSource.onopen = () => {
        setIsConnected(true)
        console.log("[ReasoningTerminal] SSE connection established")
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TraceEvent
          console.log("[ReasoningTerminal] SSE event received:", data)
          setEvents(prev => [...prev, data])
          // Automatically open terminal on routing or tool activities
          if (['routing', 'tool_start'].includes(data.type)) {
            setIsOpen(true)
          }
        } catch (err) {
          console.error("[ReasoningTerminal] Failed to parse event:", err)
        }
      }

      eventSource.onerror = (err) => {
        console.error("[ReasoningTerminal] SSE error, closing connection:", err)
        setIsConnected(false)
        eventSource?.close()
        
        // Auto-reconnect with backoff
        setTimeout(() => {
          setReconnectCount(prev => prev + 1)
        }, 3000)
      }
    }

    connectSSE()

    return () => {
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [conversationId, reconnectCount])

  // Scroll to bottom of terminal when events change
  useEffect(() => {
    if (isOpen) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [events, isOpen])

  if (!conversationId) return null

  const getEventStyle = (type: string) => {
    switch (type) {
      case 'routing':
        return 'text-blue-400 font-semibold'
      case 'tool_start':
        return 'text-yellow-400 font-medium'
      case 'tool_done':
        return 'text-emerald-400 font-semibold'
      case 'ai_response':
        return 'text-purple-400 font-medium'
      case 'done':
        return 'text-pink-400 font-bold'
      default:
        return 'text-slate-400'
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/85 backdrop-blur-md border-t border-slate-800 shadow-2xl transition-all duration-300">
      {/* Header bar */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-6 py-2.5 cursor-pointer hover:bg-slate-900/50 select-none"
      >
        <div className="flex items-center gap-2">
          <Terminal className={`h-4.5 w-4.5 ${isConnected ? "text-purple-500 animate-pulse" : "text-slate-500"}`} />
          <span className="text-xs font-bold text-slate-200 tracking-wider uppercase font-mono flex items-center gap-2">
            Live Reasoning Trace
            {events.length > 0 && (
              <span className="h-4 px-1.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-[9px] text-purple-400 animate-pulse">
                {events.length} logs
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-500 animate-ping" : "bg-red-500"}`} />
            <span className="text-slate-400">{isConnected ? "Streaming" : "Disconnected"}</span>
          </span>
          <button className="text-slate-400 hover:text-slate-200 p-0.5">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Drawer Body */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: "180px" }}
            exit={{ height: 0 }}
            className="border-t border-slate-850 bg-slate-950 overflow-hidden flex flex-col font-mono text-[11px]"
          >
            <div className="flex-1 p-4 overflow-y-auto space-y-1.5 text-slate-300 scrollbar-thin">
              {events.length === 0 ? (
                <div className="text-slate-500 italic flex items-center gap-2 justify-center h-full">
                  <Loader2 className="h-4.5 w-4.5 animate-spin text-slate-650" />
                  Waiting for agent activities...
                </div>
              ) : (
                events.map((e, idx) => (
                  <div key={idx} className="flex items-start gap-2 border-b border-slate-900/30 pb-1">
                    <span className="text-slate-600 select-none text-[9px] pt-0.5">
                      [{new Date(e.timestamp || Date.now()).toLocaleTimeString()}]
                    </span>
                    <div className="flex-1 space-y-0.5">
                      <span className={`${getEventStyle(e.type)} uppercase mr-2 text-[9px] px-1 bg-slate-900 rounded border border-slate-800`}>
                        {e.type}
                      </span>
                      {e.tool && (
                        <span className="text-purple-400 mr-2 font-semibold">
                          ({e.tool})
                        </span>
                      )}
                      <span className="text-slate-300 font-sans leading-relaxed">{e.message || (e.type === 'connected' ? 'Established streaming connection' : '')}</span>
                      
                      {e.txHash && (
                        <div className="flex items-center gap-1.5 pt-1 text-[10px]">
                          <span className="text-slate-500 font-mono">Deploy Hash:</span>
                          <span className="text-slate-400 font-mono select-all bg-slate-900/50 px-1 border border-slate-850 rounded truncate max-w-sm">{e.txHash}</span>
                          <a 
                            href={`https://testnet.cspr.live/deploy/${e.txHash}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5 hover:underline"
                          >
                            Explore <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

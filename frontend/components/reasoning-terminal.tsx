"use client"

import React, { useEffect, useState, useRef } from "react"
import { 
  Terminal, 
  ChevronUp,
  ChevronDown, 
  Loader2, 
  ExternalLink
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BLOCKCHAIN_BACKEND_URL } from "@/lib/backend"

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
      const streamUrl = `${BLOCKCHAIN_BACKEND_URL}/api/reasoning/stream/${conversationId}`
      
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
          // Automatically expand terminal when reasoning begins
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

  const getEventStyle = (type: string) => {
    switch (type) {
      case 'routing':
        return 'text-blue-500 dark:text-blue-400 font-semibold'
      case 'tool_start':
        return 'text-amber-500 dark:text-amber-400 font-semibold'
      case 'tool_done':
        return 'text-emerald-500 dark:text-emerald-400 font-semibold'
      case 'ai_response':
        return 'text-purple-500 dark:text-purple-400 font-semibold'
      case 'done':
        return 'text-pink-500 dark:text-pink-400 font-bold'
      default:
        return 'text-muted-foreground'
    }
  }

  return (
    <div className={cn(
      "shrink-0 w-full border-t border-border bg-background font-mono text-[11px] transition-all duration-300 ease-in-out flex flex-col",
      isOpen ? "h-[220px]" : "h-[36px]"
    )}>
      {/* Header bar */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-[35px] items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/20 shrink-0 cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <Terminal className={cn("h-4 w-4", isConnected ? "text-primary animate-pulse" : "text-muted-foreground")} />
          <span className="text-[10px] font-bold text-foreground tracking-wider uppercase flex items-center gap-1.5">
            Live Reasoning Trace
            {events.length > 0 && (
              <span className="h-4 px-1.5 rounded bg-muted text-[8px] text-muted-foreground flex items-center justify-center font-normal">
                {events.length} logs
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {conversationId ? (
            <span className="text-[9px] flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
              <span className="text-muted-foreground">{isConnected ? "Streaming" : "Offline"}</span>
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/50">Inactive</span>
          )}
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="text-muted-foreground hover:text-foreground p-0.5 focus:outline-none"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Drawer Body */}
      {isOpen && (
        <div className="flex-1 p-3 overflow-y-auto space-y-2 text-foreground/85 scrollbar-thin">
          {events.length === 0 ? (
            <div className="text-muted-foreground/60 italic flex items-center gap-2 justify-center h-full text-center">
              {!conversationId ? (
                <span>No active session. Send a message to start tracing.</span>
              ) : (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
                  <span>Waiting for agent reasoning activities...</span>
                </>
              )}
            </div>
          ) : (
            events.map((e, idx) => (
              <div key={idx} className="flex items-start gap-1.5 border-b border-border/20 pb-1.5 last:border-0 last:pb-0">
                <span className="text-muted-foreground/50 select-none text-[8px] pt-0.5 shrink-0">
                  [{new Date(e.timestamp || Date.now()).toLocaleTimeString()}]
                </span>
                <div className="flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={cn(getEventStyle(e.type), "uppercase text-[8px] px-1 bg-muted/60 rounded border border-border/50")}>
                      {e.type}
                    </span>
                    {e.tool && (
                      <span className="text-primary font-semibold text-[8.5px]">
                        ({e.tool})
                      </span>
                    )}
                  </div>
                  <span className="text-foreground/85 font-sans leading-relaxed text-[11.5px] block">
                    {e.message || (e.type === 'connected' ? 'Established streaming connection' : '')}
                  </span>
                  
                  {e.txHash && (
                    <div className="flex items-center gap-1 pt-0.5 text-[9px]">
                      <span className="text-muted-foreground font-mono">Deploy:</span>
                      <span className="text-muted-foreground/85 font-mono select-all bg-muted/55 px-1 border border-border rounded truncate max-w-[200px]">{e.txHash}</span>
                      <a 
                        href={`https://testnet.cspr.live/deploy/${e.txHash}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5 font-sans"
                      >
                        Explore <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={terminalEndRef} />
        </div>
      )}
    </div>
  )
}

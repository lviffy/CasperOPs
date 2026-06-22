"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { Send, Loader2, ChevronDown, ChevronUp, Wrench, ArrowLeft, ArrowRight, CircleDot, Copy, Check, Database, RefreshCw, Link2, Clock3, BellRing, X, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/use-toast"
import { UserProfile } from "@/components/user-profile"
import { useAuth } from "@/lib/auth"
import {
  getAgentById,
  getAgentAuditLogContent,
  listAgentAuditLogs,
  type AgentAuditLog,
  type AgentAuditLogContent,
} from "@/lib/agents"
import {
  cancelScheduledTransferJob,
  cancelReminderJob,
  getConversationMessages,
  listRemindersForUser,
  listScheduledTransfersForUser,
  sendChatWithMemory,
  BLOCKCHAIN_BACKEND_URL,
  type ReminderJob,
  type ScheduledTransferJob,
} from "@/lib/backend"
import type { Agent } from "@/lib/supabase"
import { useWallets } from "@privy-io/react-auth"
import { decryptStoredPrivateKey } from "@/lib/lit-private-key"
import { hasStoredPkpWallet, signTransactionWithPkp } from "@/lib/lit-pkp"
import { BrowserProvider } from "ethers"
import { CHAIN_CONFIGS, getChainConfig, getStoredChain, setStoredChain, type SupportedChainId } from "@/lib/chains"
import { getAddressFromPrivateKey } from "@/lib/wallet"

const DEFAULT_EMAIL_RECIPIENT_KEY = "blockops.defaultEmailRecipient"
const AUDIT_LOG_FETCH_LIMIT = 200

type StorageFilter = "all" | "stored" | "pending" | "failed" | "not_configured"
type AuditScopeFilter = "all" | "conversation"
type ReminderScopeFilter = "all" | "conversation"

interface ToolCallInfo {
  tool: string
  parameters: Record<string, any>
}

interface ToolResultInfo {
  success: boolean
  tool: string
  result: any
  error?: string
}

interface ToolResults {
  tool_calls: ToolCallInfo[]
  results: ToolResultInfo[]
  routing_plan?: any
  runtime?: {
    onChainId: string | null
    decision: {
      action: string
      status: string
    }
    verification: {
      allSucceeded: boolean
      verifications: Array<{
        tool: string
        txHash: string
        validationHash: string | null
        success: boolean
        blockNumber?: number
      }>
    }
    agent_log?: any
  }
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  conversationId?: string
  toolResults?: ToolResults
}

function ToolDetailsView({ toolResults }: { toolResults: ToolResults }) {
  const [isOpen, setIsOpen] = useState(false)

  if (!toolResults?.tool_calls?.length) return null

  const runtime = toolResults.runtime

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <Wrench className="h-3 w-3" />
            <span>{toolResults.tool_calls.length} tool call{toolResults.tool_calls.length > 1 ? "s" : ""}</span>
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </CollapsibleTrigger>

        {runtime?.onChainId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20 cursor-help flex items-center gap-1">
                  <CircleDot className="h-2 w-2" />
                  ERC-8004 ID: {runtime.onChainId}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-[10px]">Registered on-chain agent identity</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {runtime?.verification?.allSucceeded && (
          <Badge variant="outline" className="text-[9px] h-4 bg-green-500/10 text-green-600 border-green-500/20 flex items-center gap-1">
            <Check className="h-2 w-2" />
            On-Chain Verified
          </Badge>
        )}
      </div>

      <CollapsibleContent className="mt-2 space-y-2">
        {toolResults.tool_calls.map((toolCall, index) => {
          const result = toolResults.results[index]
          return (
            <div key={index} className="rounded-md border border-border bg-background/50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                  {toolCall.tool}
                </Badge>
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">
                  {result?.success ? "ok" : "err"}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                <div className="p-2">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Request</span>
                  <pre className="mt-1 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
                    {JSON.stringify(toolCall.parameters || {}, null, 2)}
                  </pre>
                </div>
                <div className="p-2 overflow-hidden">
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Response</span>
                  <div className="mt-1 max-h-40 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                    <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
                      {result?.error
                        ? JSON.stringify({ error: result.error }, null, 2)
                        : JSON.stringify(result?.result || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

function formatAuditTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function truncateMiddle(value: string, head = 12, tail = 10): string {
  if (value.length <= head + tail + 3) {
    return value
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "N/A"
  }

  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getStorageBadgeClass(status: string): string {
  switch (status) {
    case "stored":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
    case "pending":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600"
    case "failed":
      return "border-red-500/40 bg-red-500/10 text-red-600"
    case "not_configured":
      return "border-slate-500/40 bg-slate-500/10 text-slate-600"
    default:
      return "border-border bg-muted/40 text-muted-foreground"
  }
}

function AuditDetailField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn("mt-1 text-[11px] break-all", mono && "font-mono")}>{value}</div>
    </div>
  )
}

function AuditJsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) {
    return null
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      <pre className="max-h-55 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[10px] leading-relaxed font-mono">
        {stringifyValue(value)}
      </pre>
    </div>
  )
}

function AuditLogsSheet({
  open,
  onOpenChange,
  agentId,
  userId,
  conversationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  userId?: string
  conversationId?: string
}) {
  const [logs, setLogs] = useState<AgentAuditLog[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all")
  const [scopeFilter, setScopeFilter] = useState<AuditScopeFilter>("all")
  const [toolFilter, setToolFilter] = useState<string>("all")
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [contentById, setContentById] = useState<Record<string, AgentAuditLogContent>>({})
  const [contentErrorById, setContentErrorById] = useState<Record<string, string>>({})
  const [contentLoadingById, setContentLoadingById] = useState<Record<string, boolean>>({})

  const noConversationSelected = scopeFilter === "conversation" && !conversationId

  const fetchLogs = React.useCallback(
    async (silent = false) => {
      if (!open || !userId) {
        return
      }

      if (noConversationSelected) {
        setLogs([])
        setTotalCount(0)
        setError(null)
        if (!silent) {
          setIsLoading(false)
        }
        return
      }

      if (!silent) {
        setIsLoading(true)
      }
      setError(null)

      try {
        const response = await listAgentAuditLogs(agentId, {
          userId,
          conversationId: scopeFilter === "conversation" ? conversationId : undefined,
          tool: toolFilter !== "all" ? toolFilter : undefined,
          limit: AUDIT_LOG_FETCH_LIMIT,
        })

        setLogs(response.logs)
        setTotalCount(response.count)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load audit logs"
        setError(message)
      } finally {
        if (!silent) {
          setIsLoading(false)
        }
      }
    },
    [agentId, conversationId, noConversationSelected, open, scopeFilter, toolFilter, userId]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    void fetchLogs()
  }, [fetchLogs, open])

  const pendingCount = React.useMemo(
    () => logs.filter((log) => log.storage_status === "pending").length,
    [logs]
  )

  useEffect(() => {
    if (!open || pendingCount === 0) {
      return
    }

    const timerId = window.setInterval(() => {
      void fetchLogs(true)
    }, 7000)

    return () => window.clearInterval(timerId)
  }, [fetchLogs, open, pendingCount])

  const availableTools = React.useMemo(() => {
    const set = new Set<string>()
    logs.forEach((log) => {
      if (log.tool_name) {
        set.add(log.tool_name)
      }
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [logs])

  useEffect(() => {
    if (toolFilter === "all") {
      return
    }

    if (!availableTools.includes(toolFilter)) {
      setToolFilter("all")
    }
  }, [availableTools, toolFilter])

  const filteredLogs = React.useMemo(() => {
    if (storageFilter === "all") {
      return logs
    }

    return logs.filter((log) => log.storage_status === storageFilter)
  }, [logs, storageFilter])

  const storageFilterOptions: Array<{ value: StorageFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "stored", label: "Stored" },
    { value: "pending", label: "Pending" },
    { value: "failed", label: "Failed" },
    { value: "not_configured", label: "Not Config" },
  ]

  const handleLoadStoredJson = async (logId: string) => {
    if (!userId || contentLoadingById[logId] || contentById[logId]) {
      return
    }

    setContentLoadingById((prev) => ({ ...prev, [logId]: true }))
    setContentErrorById((prev) => {
      const next = { ...prev }
      delete next[logId]
      return next
    })

    try {
      const content = await getAgentAuditLogContent(agentId, logId, userId)
      setContentById((prev) => ({ ...prev, [logId]: content }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load stored JSON"
      setContentErrorById((prev) => ({ ...prev, [logId]: message }))
    } finally {
      setContentLoadingById((prev) => ({ ...prev, [logId]: false }))
    }
  }

  const handleClearStoredJson = (logId: string) => {
    setContentById((prev) => {
      const next = { ...prev }
      delete next[logId]
      return next
    })
    setContentErrorById((prev) => {
      const next = { ...prev }
      delete next[logId]
      return next
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full min-h-0 gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2 pr-8">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Tool Audit Logs
              </SheetTitle>
              <SheetDescription>
                View persisted Filecoin and execution details for every tool call.
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void fetchLogs()}
              disabled={isLoading || !userId}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant={scopeFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setScopeFilter("all")}
              >
                All Conversations
              </Button>
              <Button
                type="button"
                variant={scopeFilter === "conversation" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setScopeFilter("conversation")}
              >
                This Chat
              </Button>
              {!conversationId && scopeFilter === "conversation" && (
                <span className="text-[11px] text-muted-foreground">
                  Start a chat first to filter by conversation.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {storageFilterOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={storageFilter === option.value ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setStorageFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}

              <select
                className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                value={toolFilter}
                onChange={(event) => setToolFilter(event.target.value)}
              >
                <option value="all">All tools</option>
                {availableTools.map((tool) => (
                  <option key={tool} value={tool}>
                    {tool}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Rows loaded: {logs.length}</span>
              <span>Total matching query: {totalCount}</span>
              {pendingCount > 0 && (
                <Badge variant="outline" className="h-5 border-amber-500/40 bg-amber-500/10 text-amber-600">
                  {pendingCount} pending (auto-refresh active)
                </Badge>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isLoading && logs.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading audit logs...
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {!isLoading && !error && filteredLogs.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {noConversationSelected
                ? "No conversation selected yet. Send one message and try again."
                : "No audit logs found for the selected filters."}
            </div>
          )}

          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const isExpanded = Boolean(expandedById[log.id])
              const storedContent = contentById[log.id]
              const contentError = contentErrorById[log.id]
              const contentLoading = Boolean(contentLoadingById[log.id])

              return (
                <Collapsible
                  key={log.id}
                  open={isExpanded}
                  onOpenChange={(nextOpen) =>
                    setExpandedById((prev) => ({
                      ...prev,
                      [log.id]: nextOpen,
                    }))
                  }
                  className="rounded-md border border-border overflow-hidden"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full bg-background px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="h-5 text-[10px] font-mono px-1.5">
                              {log.tool_name}
                            </Badge>
                            <Badge
                              variant={log.success ? "secondary" : "destructive"}
                              className="h-5 px-1.5 text-[10px]"
                            >
                              {log.success ? "success" : "failed"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("h-5 px-1.5 text-[10px]", getStorageBadgeClass(log.storage_status))}
                            >
                              {log.storage_status}
                            </Badge>
                            {log.chain && (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                {log.chain}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{formatAuditTimestamp(log.created_at)}</p>
                          {log.message_excerpt && (
                            <p className="mt-1 text-xs text-muted-foreground wrap-break-word">{log.message_excerpt}</p>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="mt-1 h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-border bg-muted/10 px-3 py-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <AuditDetailField label="Log ID" value={log.id} mono />
                      <AuditDetailField label="Conversation" value={log.conversation_id || "N/A"} mono />
                      <AuditDetailField label="Execution Mode" value={log.execution_mode || "N/A"} />
                      <AuditDetailField label="Tool Index" value={log.tool_index ?? "N/A"} />
                      <AuditDetailField label="Transaction Hash" value={log.tx_hash || "N/A"} mono />
                      <AuditDetailField label="Amount" value={log.amount || "N/A"} mono />
                      <AuditDetailField
                        label="Filecoin CID"
                        value={log.filecoin_cid ? truncateMiddle(log.filecoin_cid) : "N/A"}
                        mono
                      />
                      <AuditDetailField
                        label="Filecoin URI"
                        value={
                          log.filecoin_uri ? (
                            <a
                              href={log.filecoin_uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                            >
                              <Link2 className="h-3 w-3" />
                              {truncateMiddle(log.filecoin_uri, 18, 16)}
                            </a>
                          ) : (
                            "N/A"
                          )
                        }
                      />
                      <AuditDetailField label="Filecoin Provider" value={log.filecoin_provider || "N/A"} />
                      <AuditDetailField label="Storage Error" value={log.storage_error || "N/A"} />
                    </div>

                    <AuditJsonBlock title="Sanitized Params" value={log.params_sanitized} />
                    <AuditJsonBlock title="Result Summary" value={log.result_summary} />
                    <AuditJsonBlock title="Raw Result" value={log.raw_result} />
                    <AuditJsonBlock title="Full Stored Row" value={log} />

                    {log.storage_status === "stored" && log.filecoin_cid && (
                      <div className="space-y-2 rounded-md border border-border bg-background/50 p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Filecoin Stored JSON
                          </p>
                          {!storedContent && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => void handleLoadStoredJson(log.id)}
                              disabled={contentLoading || !userId}
                            >
                              {contentLoading ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  Loading...
                                </>
                              ) : (
                                "View Stored JSON"
                              )}
                            </Button>
                          )}

                          {storedContent && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => handleClearStoredJson(log.id)}
                            >
                              Hide
                            </Button>
                          )}
                        </div>

                        {contentError && (
                          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600">
                            {contentError}
                          </div>
                        )}

                        {storedContent && (
                          <>
                            <AuditJsonBlock title="Stored Envelope (exact upload JSON)" value={storedContent.envelope} />
                            <AuditJsonBlock title="Stored Payload" value={storedContent.payload} />
                            <AuditJsonBlock title="Stored Metadata" value={storedContent.metadata} />
                            {storedContent.filecoin.contentType === "text" && (
                              <AuditJsonBlock title="Raw Stored Text" value={storedContent.rawText} />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatReminderTimestamp(value?: string | null): string {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatReminderSchedule(expression?: string | null, type?: string | null): string {
  if (!expression) {
    return "N/A"
  }

  const isOneShot = String(type || "").toLowerCase() === "one_shot" || /^\d{4}-\d{2}-\d{2}/.test(expression)
  if (isOneShot) {
    const date = new Date(expression)
    if (!Number.isNaN(date.getTime())) {
      return `One-shot at ${date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })} (UTC)`
    }
    return `One-shot at ${expression}`
  }

  return `Cron: ${expression} (UTC)`
}

function getReminderTargetLabel(job: ReminderJob): string {
  const taskType = String(job.task_type || "").toLowerCase()

  if (taskType === "price") {
    return job.token_query ? `Token: ${job.token_query}` : "Token: N/A"
  }

  return job.wallet_address ? `Wallet: ${job.wallet_address}` : "Wallet: N/A"
}

function getReminderDisplayStatus(job: ReminderJob): string {
  return String(job.liveStatus || job.status || "unknown")
}

function getReminderStatusClass(job: ReminderJob): string {
  const status = getReminderDisplayStatus(job).toLowerCase()
  if (status === "running" || status === "active") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
  }
  if (status === "pending_reload") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-600"
  }
  if (status === "cancelled" || status === "completed") {
    return "border-slate-500/40 bg-slate-500/10 text-slate-600"
  }
  return "border-border bg-muted/40 text-muted-foreground"
}

function isReminderCancellable(job: ReminderJob): boolean {
  const status = String(job.status || "").toLowerCase()
  const liveStatus = String(job.liveStatus || "").toLowerCase()
  return status === "active" || liveStatus === "running" || liveStatus === "pending_reload"
}

function getTransferDisplayStatus(job: ScheduledTransferJob): string {
  return String(job.liveStatus || job.status || "unknown")
}

function getTransferStatusClass(job: ScheduledTransferJob): string {
  const status = getTransferDisplayStatus(job).toLowerCase()
  if (status === "running" || status === "active") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
  }
  if (status === "pending_reload") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-600"
  }
  if (status === "cancelled" || status === "completed") {
    return "border-slate-500/40 bg-slate-500/10 text-slate-600"
  }
  return "border-border bg-muted/40 text-muted-foreground"
}

function isTransferCancellable(job: ScheduledTransferJob): boolean {
  const status = String(job.status || "").toLowerCase()
  const liveStatus = String(job.liveStatus || "").toLowerCase()
  return status === "active" || liveStatus === "running" || liveStatus === "pending_reload"
}

function getTransferTargetLabel(job: ScheduledTransferJob): string {
  return job.to_address ? `To: ${job.to_address}` : "To: N/A"
}

function formatTransferAmount(job: ScheduledTransferJob): string {
  if (!job.amount) {
    return "N/A"
  }

  return job.token_address ? `${job.amount} (ERC20)` : `${job.amount} ETH`
}

function ReminderJobsSheet({
  open,
  onOpenChange,
  agentId,
  userId,
  conversationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  userId?: string
  conversationId?: string
}) {
  const [jobs, setJobs] = useState<ReminderJob[]>([])
  const [transferJobs, setTransferJobs] = useState<ScheduledTransferJob[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<ReminderScopeFilter>("all")
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelingTransferId, setCancelingTransferId] = useState<string | null>(null)

  const noConversationSelected = scopeFilter === "conversation" && !conversationId

  const fetchJobs = React.useCallback(
    async (silent = false) => {
      if (!open || !userId) {
        return
      }

      if (noConversationSelected) {
        setJobs([])
        setTransferJobs([])
        setTotalCount(0)
        setError(null)
        if (!silent) {
          setIsLoading(false)
        }
        return
      }

      if (!silent) {
        setIsLoading(true)
      }
      setError(null)

      try {
        const [remindersResult, transfersResult] = await Promise.allSettled([
          listRemindersForUser({
            userId,
            agentId,
          }),
          listScheduledTransfersForUser({
            userId,
            agentId,
          }),
        ])

        const partialErrors: string[] = []
        let reminderJobs: ReminderJob[] = []
        let reminderTotal = 0
        let scheduledJobs: ScheduledTransferJob[] = []
        let scheduledTotal = 0

        if (remindersResult.status === "fulfilled") {
          reminderJobs = remindersResult.value.jobs || []
          reminderTotal = remindersResult.value.total || 0
        } else {
          partialErrors.push(
            remindersResult.reason instanceof Error
              ? remindersResult.reason.message
              : "Failed to load reminders"
          )
        }

        if (transfersResult.status === "fulfilled") {
          scheduledJobs = transfersResult.value.jobs || []
          scheduledTotal = transfersResult.value.total || 0
        } else {
          partialErrors.push(
            transfersResult.reason instanceof Error
              ? transfersResult.reason.message
              : "Failed to load scheduled transfers"
          )
        }

        setJobs(reminderJobs)
        setTransferJobs(scheduledJobs)
        setTotalCount(reminderTotal + scheduledTotal)

        if (partialErrors.length > 0) {
          setError(partialErrors.join(" | "))
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load reminders"
        setError(message)
      } finally {
        if (!silent) {
          setIsLoading(false)
        }
      }
    },
    [agentId, noConversationSelected, open, userId]
  )

  useEffect(() => {
    if (!open) {
      return
    }

    void fetchJobs()
  }, [fetchJobs, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const timerId = window.setInterval(() => {
      void fetchJobs(true)
    }, 7000)

    return () => window.clearInterval(timerId)
  }, [fetchJobs, open])

  const filteredJobs = React.useMemo(() => {
    if (scopeFilter !== "conversation") {
      return jobs
    }

    if (!conversationId) {
      return []
    }

    return jobs.filter((job) => job.conversation_id === conversationId)
  }, [conversationId, jobs, scopeFilter])

  const filteredTransferJobs = React.useMemo(() => transferJobs, [transferJobs])

  const activeCount = React.useMemo(
    () => (
      filteredJobs.filter((job) => isReminderCancellable(job)).length
      + filteredTransferJobs.filter((job) => isTransferCancellable(job)).length
    ),
    [filteredJobs, filteredTransferJobs]
  )

  const handleCancelReminder = async (job: ReminderJob) => {
    if (!job.id || !userId || cancelingId) {
      return
    }

    setCancelingId(job.id)

    try {
      const response = await cancelReminderJob({
        id: job.id,
        userId,
        agentId,
      })

      const cancelledIds = new Set(
        (response.cancelledIds && response.cancelledIds.length > 0
          ? response.cancelledIds
          : [job.id])
      )
      setJobs((prev) => prev.filter((item) => !cancelledIds.has(item.id)))

      const count = response.cancelledCount || response.cancelledIds?.length || 1
      toast({
        title: count > 1 ? "Reminders cancelled" : "Reminder cancelled",
        description: count > 1
          ? `${count} reminder jobs were cancelled.`
          : `Reminder ${job.id} was cancelled.`,
      })

      await fetchJobs(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to cancel reminder"
      toast({
        title: "Cancel failed",
        description: message,
        variant: "destructive",
      })
    } finally {
      setCancelingId(null)
    }
  }

  const handleCancelTransfer = async (job: ScheduledTransferJob) => {
    if (!job.id || !userId || cancelingTransferId) {
      return
    }

    setCancelingTransferId(job.id)

    try {
      await cancelScheduledTransferJob({
        id: job.id,
        userId,
        agentId,
      })

      setTransferJobs((prev) => prev.filter((item) => item.id !== job.id))

      toast({
        title: "Scheduled transfer cancelled",
        description: `Scheduled transfer ${job.id} was cancelled.`,
      })

      await fetchJobs(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to cancel scheduled transfer"
      toast({
        title: "Cancel failed",
        description: message,
        variant: "destructive",
      })
    } finally {
      setCancelingTransferId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full min-h-0 gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2 pr-8">
            <div>
              <SheetTitle className="flex items-center gap-2 text-base">
                <BellRing className="h-4 w-4" />
                Scheduled Jobs
              </SheetTitle>
              <SheetDescription>
                Monitor active reminder and transfer schedules, including one-shot timers.
              </SheetDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void fetchJobs()}
              disabled={isLoading || !userId}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant={scopeFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setScopeFilter("all")}
              >
                All Jobs
              </Button>
              <Button
                type="button"
                variant={scopeFilter === "conversation" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setScopeFilter("conversation")}
              >
                This Chat
              </Button>
              {!conversationId && scopeFilter === "conversation" && (
                <span className="text-[11px] text-muted-foreground">
                  Start a chat first to filter by conversation.
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Rows loaded: {filteredJobs.length + filteredTransferJobs.length}</span>
              <span>Total matching query: {totalCount}</span>
              <Badge variant="outline" className="h-5 border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
                {activeCount} active
              </Badge>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {isLoading && filteredJobs.length === 0 && filteredTransferJobs.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading scheduled jobs...
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {!isLoading && !error && filteredJobs.length === 0 && filteredTransferJobs.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {noConversationSelected
                ? "No conversation selected yet. Send one message and try again."
                : "No scheduled reminder or transfer jobs found for the selected scope."}
            </div>
          )}

          {filteredJobs.length > 0 && (
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Reminder jobs</p>
          )}

          {filteredJobs.map((job) => {
            const cancellable = isReminderCancellable(job)
            const isCanceling = cancelingId === job.id
            const displayStatus = getReminderDisplayStatus(job)

            return (
              <div key={job.id} className="rounded-md border border-border bg-background px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="h-5 text-[10px] font-mono px-1.5">
                        {job.task_type || "reminder"}
                      </Badge>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {job.type || "recurring"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("h-5 px-1.5 text-[10px]", getReminderStatusClass(job))}
                      >
                        {displayStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-all">{job.id}</p>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void handleCancelReminder(job)}
                    disabled={!cancellable || isCanceling || !userId}
                  >
                    {isCanceling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-3.5 w-3.5" />
                        Cancel
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Schedule</p>
                    <p className="mt-1 wrap-break-word">{formatReminderSchedule(job.cron_expression, job.type)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Target</p>
                    <p className="mt-1 break-all">{getReminderTargetLabel(job)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Created</p>
                    <p className="mt-1">{formatReminderTimestamp(job.created_at)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Last Run</p>
                    <p className="mt-1">{formatReminderTimestamp(job.last_run_at)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Runs: {job.run_count ?? 0}</span>
                  {job.label && <span>Label: {job.label}</span>}
                </div>

                {job.last_error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600">
                    Last error: {job.last_error}
                  </div>
                )}
              </div>
            )
          })}

          {filteredTransferJobs.length > 0 && (
            <p className="pt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Transfer schedules</p>
          )}

          {filteredTransferJobs.map((job) => {
            const cancellable = isTransferCancellable(job)
            const isCanceling = cancelingTransferId === job.id
            const displayStatus = getTransferDisplayStatus(job)

            return (
              <div key={job.id} className="rounded-md border border-border bg-background px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="h-5 text-[10px] font-mono px-1.5">
                        transfer
                      </Badge>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {job.type || "recurring"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("h-5 px-1.5 text-[10px]", getTransferStatusClass(job))}
                      >
                        {displayStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-all">{job.id}</p>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void handleCancelTransfer(job)}
                    disabled={!cancellable || isCanceling || !userId}
                  >
                    {isCanceling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-3.5 w-3.5" />
                        Cancel
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Schedule</p>
                    <p className="mt-1 wrap-break-word">{formatReminderSchedule(job.cron_expression, job.type)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Target</p>
                    <p className="mt-1 break-all">{getTransferTargetLabel(job)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Amount</p>
                    <p className="mt-1 break-all">{formatTransferAmount(job)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-2">
                    <p className="uppercase tracking-wider text-[10px] text-muted-foreground">Created</p>
                    <p className="mt-1">{formatReminderTimestamp(job.created_at)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Runs: {job.run_count ?? 0}</span>
                  {job.label && <span>Label: {job.label}</span>}
                </div>

                {job.last_error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-600">
                    Last error: {job.last_error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatContent(content: string): string {
  // Clean up AI thinking / reasoning that leaks into the response
  let cleaned = content
    // Remove lines like "The user wants to..." or "I need to use the send_email tool..."
    .replace(/^(The user wants to[\s\S]*?(?:\n\n|$))/m, '')
    .replace(/^(I need to use the \w+ tool[\s\S]*?(?:\n\n|$))/m, '')
    .replace(/^(I'?ll compose[\s\S]*?(?:\n\n|$))/m, '')
    // Remove standalone raw JSON blocks that aren't in code fences
    .replace(/^\{\n\s+"to":[\s\S]*?^\}$/gm, '')
    // Remove duplicate JSON echo like {"to": "...", "subject": "...", "body": "..."}
    .replace(/^\{"to":\s*"[^"]+",\s*"subject":\s*"[^"]+",\s*"(?:body|text)":\s*"[^"]*"\}$/gm, '')
    // Trim leading/trailing whitespace and collapse excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return cleaned
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:text-foreground/80 transition-colors">$1</a>')
    .replace(/(https?:\/\/[^\s<]+)/g, (match) => {
      if (match.includes('href="')) return match
      return `<a href="${match}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:text-foreground/80 transition-colors">${match}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/```(?:json)?\n([\s\S]*?)\n```/g, (_, code) => {
      return `<pre class="mt-2 rounded border border-border bg-muted/40 p-2.5 font-mono text-[11px] overflow-x-auto leading-relaxed">${code}</pre>`
    })
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
}

export default function AgentChatPage() {
  const router = useRouter()
  const params = useParams()
  const agentId = params.agentId as string
  const { logout, dbUser, privyWalletAddress, user } = useAuth()
  const { wallets } = useWallets()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loadingAgent, setLoadingAgent] = useState(true)
  const [copiedId, setCopiedId] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [reputationScore, setReputationScore] = useState<number | null>(null)
  const [isAuditSheetOpen, setIsAuditSheetOpen] = useState(false)
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [selectedChain, setSelectedChain] = useState<SupportedChainId>("flow-testnet")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendInFlightRef = useRef(false)
  const selectedChainConfig = getChainConfig(selectedChain)

  // Function to handle MetaMask transaction signing
  const handleMetaMaskTransaction = async (txData: any): Promise<string> => {
    try {
      if (!wallets || wallets.length === 0) {
        throw new Error("No wallet connected. Please connect your wallet.")
      }

      const wallet = wallets[0]
      await wallet.switchChain(selectedChainConfig.chainId)

      const ethereumProvider = await wallet.getEthereumProvider()
      const provider = new BrowserProvider(ethereumProvider)
      const signer = await provider.getSigner()

      const tx = await signer.sendTransaction(txData.transaction)
      const receipt = await tx.wait()
        
        if (!receipt) throw new Error("Transaction failed to confirm")

      if (!receipt) {
        throw new Error("Transaction receipt not available")
      }

      return receipt.hash
    } catch (error: any) {
      console.error("MetaMask transaction error:", error)
      throw new Error(`Transaction failed: ${error.message}`)
    }
  }

  const handlePkpTransaction = async (txData: any): Promise<{ hash: string; explorerUrl: string }> => {
    if (!hasStoredPkpWallet(dbUser)) {
      throw new Error("No PKP wallet is configured for this account.")
    }

    const signed = await signTransactionWithPkp({
      pkpPublicKey: dbUser.pkp_public_key,
      pkpTokenId: dbUser.pkp_token_id,
      chain: selectedChain,
      transaction: {
        to: txData.transaction?.to,
        data: txData.transaction?.data || null,
        value: txData.transaction?.value ? String(txData.transaction.value) : null,
      },
    })

    return {
      hash: signed.hash,
      explorerUrl: signed.explorerUrl,
    }
  }

  useEffect(() => {
    setSelectedChain(getStoredChain())
  }, [])

  useEffect(() => {
    if (agent?.on_chain_id) {
      fetchReputation(agent.on_chain_id);
    }
  }, [agent]);

  const fetchReputation = async (onChainId: string) => {
    try {
      const provider = new ethers.JsonRpcProvider("https://sepolia-rollup.arbitrum.io/rpc");
      const reputationAddr = process.env.NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS || "0xa497e1BFe08109D60A8F91AdEc868ffdD1e0055c";
      
      const REPUTATION_ABI = [
        "function getAverageScore(uint256 agentId, string memory tag) public view returns (uint256)"
      ];

      const reputationContract = new ethers.Contract(reputationAddr, REPUTATION_ABI, provider);
      const score = await reputationContract.getAverageScore(onChainId, "successRate");
      setReputationScore(Number(score));
    } catch (e) {
      console.error("Error fetching reputation:", e);
    }
  };

  useEffect(() => {
    const fetchAgent = async () => {
      if (!agentId) { router.push("/my-agents"); return }
      try {
        const agentData = await getAgentById(agentId)
        if (!agentData) {
          toast({ title: "Agent not found", description: "The agent you're looking for doesn't exist", variant: "destructive" })
          router.push("/my-agents")
          return
        }
        setAgent(agentData)
      } catch (error: any) {
        console.error("Error loading agent:", error)
        toast({ title: "Error", description: "Failed to load agent", variant: "destructive" })
        router.push("/my-agents")
      } finally {
        setLoadingAgent(false)
      }
    }
    fetchAgent()
  }, [agentId, router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!loadingAgent && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [loadingAgent])

  const handleSend = async () => {
    if (!input.trim() || isLoading || sendInFlightRef.current || !agent || !dbUser?.id) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    const userQuery = input.trim()
    setInput("")
    setIsLoading(true)
    sendInFlightRef.current = true

    try {
      let resolvedPrivateKey: string | undefined
      let derivedSignerAddress: string | undefined
      if (dbUser?.private_key) {
        try {
          resolvedPrivateKey = (await decryptStoredPrivateKey(dbUser.private_key)) || undefined
          if (resolvedPrivateKey) {
            derivedSignerAddress = getAddressFromPrivateKey(resolvedPrivateKey)
          }
        } catch (error: any) {
          console.warn("Failed to decrypt stored private key for chat request:", error)
        }
      }

      if (
        dbUser?.wallet_address &&
        derivedSignerAddress &&
        dbUser.wallet_address.toLowerCase() !== derivedSignerAddress.toLowerCase()
      ) {
        console.warn("Stored agent wallet address does not match decrypted private key address.", {
          storedWalletAddress: dbUser.wallet_address,
          derivedSignerAddress,
        })
      }

      const savedEmailRecipient = typeof window !== "undefined"
        ? window.localStorage.getItem(DEFAULT_EMAIL_RECIPIENT_KEY)?.trim()
        : ""
      const effectiveDefaultEmailTo = savedEmailRecipient || user?.email?.address || undefined
      const effectiveWalletAddress =
        derivedSignerAddress ||
        dbUser?.wallet_address ||
        privyWalletAddress ||
        undefined

      const data = await sendChatWithMemory({
        agentId: agent.id,
        userId: dbUser.id,
        message: userQuery,
        chain: selectedChain,
        conversationId: conversationId,
        deliveryPlatform: "web",
        systemPrompt: `You are a helpful AI assistant for blockchain operations. The agent has these tools: ${agent.tools?.map((t) => t.tool).join(", ")}`,
        walletAddress: effectiveWalletAddress,
        walletType: dbUser?.wallet_type || undefined,
        pkpPublicKey: dbUser?.pkp_public_key || undefined,
        pkpTokenId: dbUser?.pkp_token_id || undefined,
        privateKey: resolvedPrivateKey,
        defaultEmailTo: effectiveDefaultEmailTo,
        userEmail: user?.email?.address || undefined,
      })

      if (data.isNewConversation) {
        setConversationId(data.conversationId)
      }

      // Check if any tool results require MetaMask signing
      let finalMessage = data.message
      if (data.toolResults?.results) {
        for (const result of data.toolResults.results) {
          if (result.success && result.result?.requiresMetaMask && result.result?.transaction) {
            try {
              // Show signing prompt
              toast({
                title: "Transaction Signing",
                description: "Please confirm the transaction in your wallet...",
              })

              const txHash = await handleMetaMaskTransaction(result.result)
              
              // Update message with transaction hash
              const explorerUrl = `${selectedChainConfig.explorerBaseUrl}/tx/${txHash}`
              finalMessage += `\n\n✅ Transaction confirmed!\nTransaction Hash: [${txHash.slice(0, 10)}...${txHash.slice(-8)}](${explorerUrl})`
              
              toast({
                title: "Success",
                description: "Transaction confirmed on blockchain",
              })
            } catch (error: any) {
              finalMessage += `\n\n❌ Transaction failed: ${error.message}`
              toast({
                title: "Transaction Failed",
                description: error.message,
                variant: "destructive",
              })
            }
          } else if (result.success && result.result?.requiresSigning && result.result?.transaction && hasStoredPkpWallet(dbUser)) {
            try {
              toast({
                title: "PKP Signing",
                description: "Signing the prepared transaction with your Lit PKP wallet...",
              })

              const signedTx = await handlePkpTransaction(result.result)
              finalMessage += `\n\n✅ PKP transaction confirmed!\nTransaction Hash: [${signedTx.hash.slice(0, 10)}...${signedTx.hash.slice(-8)}](${signedTx.explorerUrl})`

              toast({
                title: "Success",
                description: "Transaction confirmed with your PKP wallet",
              })
            } catch (error: any) {
              finalMessage += `\n\n❌ PKP transaction failed: ${error.message}`
              toast({
                title: "PKP Transaction Failed",
                description: error.message,
                variant: "destructive",
              })
            }
          }
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: finalMessage,
        timestamp: new Date(),
        conversationId: data.conversationId,
        toolResults: data.toolResults,
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${error.message || "Failed to get response from agent"}`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
      toast({ title: "Error", description: error.message || "Failed to chat with agent", variant: "destructive" })
    } finally {
      setIsLoading(false)
      sendInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!conversationId || !dbUser?.id || isLoading) {
      return
    }

    let cancelled = false

    const syncMessages = async () => {
      try {
        const response = await getConversationMessages(conversationId)
        if (cancelled) return

        const hydratedMessages: Message[] = (response.messages || []).map((message: any) => ({
          id: message.id,
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
          timestamp: new Date(message.created_at),
          conversationId,
          toolResults: message.tool_calls || undefined,
        }))

        setMessages(hydratedMessages)
      } catch (error) {
        console.warn("Failed to sync conversation messages:", error)
      }
    }

    void syncMessages()
    const timerId = window.setInterval(() => {
      void syncMessages()
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [conversationId, dbUser?.id, isLoading])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loadingAgent) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!agent) return null

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background">
        {/* Header */}
        <header className="shrink-0 border-b border-border">
          <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => router.push("/my-agents")}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Back</p></TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex flex-col">
                <h1 className="text-sm font-semibold text-foreground truncate max-w-[120px] sm:max-w-[200px]">
                  {agent?.name || "Agent Chat"}
                </h1>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", agent ? "bg-green-500" : "bg-muted-foreground/30")} />
                    {agent ? "Online" : "Loading..."}
                  </span>
                  {reputationScore !== null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="h-3.5 px-1 text-[9px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20 flex items-center gap-0.5 cursor-help">
                          <Star className="h-2 w-2 fill-current" />
                          {reputationScore}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[10px] p-2 max-w-[200px]">
                        <p className="font-semibold mb-1">Decentralized Reputation</p>
                        <p className="text-muted-foreground">This score is calculated from on-chain feedback and verified execution proofs (ERC-8004).</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {agent?.on_chain_id && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge 
                          variant="outline" 
                          className="h-3.5 px-1 text-[9px] bg-primary/10 text-primary border-primary/20 flex items-center gap-0.5 cursor-help"
                          onClick={() => window.open(`${BLOCKCHAIN_BACKEND_URL}/agents/${agent.id}/manifest`, '_blank')}
                        >
                          <ShieldCheck className="h-2 w-2" />
                          ERC-8004
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[10px] p-2 max-w-[200px]">
                        <p className="font-semibold mb-1">On-Chain Identity Verified</p>
                        <p className="text-muted-foreground mb-2">This agent is registered in the BlockOps Identity Registry with ID #{agent.on_chain_id}.</p>
                        <p className="text-primary hover:underline cursor-pointer">Click to view manifest</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 py-0 font-normal">
                {agent.tools?.length || 0} {(agent.tools?.length || 0) === 1 ? "tool" : "tools"}
              </Badge>
              <select
                className="h-6 rounded-md border border-border bg-background px-2 text-[10px] text-muted-foreground"
                value={selectedChain}
                onChange={(event) => {
                  const nextChain = event.target.value as SupportedChainId
                  setSelectedChain(nextChain)
                  setStoredChain(nextChain)
                }}
              >
                {Object.values(CHAIN_CONFIGS).map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted/60 transition-colors group/id"
                    onClick={() => {
                      navigator.clipboard.writeText(agentId as string)
                      setCopiedId(true)
                      setTimeout(() => setCopiedId(false), 2000)
                    }}
                  >
                    <code className="text-[10px] font-mono text-muted-foreground">
                      {(agentId as string).slice(0, 8)}...
                    </code>
                    {copiedId ? (
                      <Check className="h-2.5 w-2.5 text-muted-foreground" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 text-muted-foreground/50 group-hover/id:text-muted-foreground transition-colors" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Copy Agent ID</p></TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setIsReminderSheetOpen(true)}
                disabled={!dbUser?.id}
              >
                <Clock3 className="h-3.5 w-3.5" />
                Schedules
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setIsAuditSheetOpen(true)}
                disabled={!dbUser?.id}
              >
                <Database className="h-3.5 w-3.5" />
                Audit Logs
              </Button>
              <UserProfile
                onLogout={() => {
                  logout()
                  router.push("/")
                }}
              />
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6">
            {messages.length === 0 && (
              <div className="flex min-h-[65vh] items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border">
                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">Send a message to begin.</p>
                  <p className="text-[11px] text-muted-foreground">Default execution chain: {selectedChainConfig.name}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5",
                      message.role === "user"
                        ? "bg-foreground text-background rounded-br-md"
                        : "bg-muted/60 text-foreground border border-border rounded-bl-md"
                    )}
                  >
                    <div
                      className="text-sm leading-relaxed whitespace-pre-wrap [&_a]:underline [&_a]:underline-offset-2"
                      dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
                    />

                    {message.role === "assistant" && message.toolResults && (
                      <ToolDetailsView toolResults={message.toolResults} />
                    )}

                    <div
                      className={cn(
                        "text-[10px] mt-1.5",
                        message.role === "user" ? "text-background/50" : "text-muted-foreground/60"
                      )}
                    >
                      {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted/60 border border-border rounded-2xl rounded-bl-md px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Thinking…</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Input */}
        <footer className="shrink-0 border-t border-border bg-background">
          <div className="mx-auto flex max-w-2xl items-end gap-2 px-4 py-3">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message…"
              className="min-h-10 max-h-30 flex-1 resize-none rounded-lg border-border bg-muted/30 px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring"
              disabled={isLoading || !dbUser?.id}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading || !dbUser?.id}
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-lg bg-foreground text-background hover:bg-foreground/90"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top"><p>Send</p></TooltipContent>
            </Tooltip>
          </div>
        </footer>
      </div>

      <AuditLogsSheet
        open={isAuditSheetOpen}
        onOpenChange={setIsAuditSheetOpen}
        agentId={agent.id}
        userId={dbUser?.id}
        conversationId={conversationId}
      />

      <ReminderJobsSheet
        open={isReminderSheetOpen}
        onOpenChange={setIsReminderSheetOpen}
        agentId={agent.id}
        userId={dbUser?.id}
        conversationId={conversationId}
      />
    </TooltipProvider>
  )
}

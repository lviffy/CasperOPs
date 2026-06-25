"use client"

import { useEffect, useState } from "react"
import { X, Send, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/use-toast"
import type { WorkflowNode } from "@/lib/types"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000"
const DEFAULT_EMAIL_RECIPIENT_KEY = "blockops.defaultEmailRecipient"

interface NodeConfigPanelProps {
  node: WorkflowNode
  updateNodeData: (nodeId: string, data: any) => void
  onClose: () => void
}

export default function NodeConfigPanel({ node, updateNodeData, onClose }: NodeConfigPanelProps) {
  const isEmail = node.type === "send_email"

  // Email form state
  const [to, setTo] = useState((node.data.config as any)?.to || "")
  const [subject, setSubject] = useState((node.data.config as any)?.subject || "")
  const [body, setBody] = useState((node.data.config as any)?.text || "")
  const [cc, setCc] = useState((node.data.config as any)?.cc || "")
  const [bcc, setBcc] = useState((node.data.config as any)?.bcc || "")
  const [replyTo, setReplyTo] = useState((node.data.config as any)?.replyTo || "")
  const [useHtml, setUseHtml] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!isEmail || typeof window === "undefined") return
    if (to.trim()) return

    const savedRecipient = window.localStorage.getItem(DEFAULT_EMAIL_RECIPIENT_KEY)?.trim()
    if (!savedRecipient) return

    setTo(savedRecipient)
    updateNodeData(node.id, {
      config: {
        ...((node.data.config as any) || {}),
        to: savedRecipient,
      },
    })
  }, [isEmail, node.id, node.data.config, to, updateNodeData])

  // Persist config changes back to the node
  const syncConfig = (overrides: Record<string, string> = {}) => {
    const config = { to, subject, text: body, cc, bcc, replyTo, ...overrides }
    updateNodeData(node.id, { config })
  }

  const handleSaveRecipient = () => {
    const trimmed = to.trim()
    if (!trimmed || typeof window === "undefined") {
      return
    }

    window.localStorage.setItem(DEFAULT_EMAIL_RECIPIENT_KEY, trimmed)
    syncConfig({ to: trimmed })
    toast({
      title: "Recipient saved",
      description: "Default email recipient has been saved for future use.",
    })
  }

  const handleSendEmail = async () => {
    if (!to) {
      setSendResult({ success: false, message: "At least the 'To' field is required to send." })
      return
    }
    setSending(true)
    setSendResult(null)
    try {
      const payload: Record<string, any> = {
        to: to.split(",").map((e: string) => e.trim()),
        subject,
        ...(useHtml ? { html: body } : { text: body }),
        ...(cc && { cc }),
        ...(bcc && { bcc }),
        ...(replyTo && { replyTo }),
      }
      const res = await fetch(`${BACKEND_URL}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.success) {
        setSendResult({ success: true, message: `Sent! ID: ${data.messageId}` })
      } else {
        setSendResult({ success: false, message: data.error || "Failed to send email" })
      }
    } catch (err: any) {
      setSendResult({ success: false, message: err.message || "Network error" })
    } finally {
      setSending(false)
    }
  }

  // ── Email config panel ──
  if (isEmail) {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Send Email</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 flex-1 overflow-y-auto pr-1">
          {/* To */}
          <div className="space-y-1">
            <Label htmlFor="email-to" className="text-xs font-medium">
              To
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="email-to"
                placeholder="alice@example.com, bob@example.com"
                value={to}
                onChange={(e) => { setTo(e.target.value); syncConfig({ to: e.target.value }) }}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={handleSaveRecipient}
                disabled={!to.trim()}
              >
                Save
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Comma-separated for multiple recipients</p>
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <Label htmlFor="email-subject" className="text-xs font-medium">
              Subject
            </Label>
            <Input
              id="email-subject"
              placeholder="Transaction Receipt — Token Deployment"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); syncConfig({ subject: e.target.value }) }}
            />
          </div>

          {/* Body */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="email-body" className="text-xs font-medium">
                Body
              </Label>
              <button
                type="button"
                onClick={() => setUseHtml(!useHtml)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  useHtml
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground border-gray-300 hover:border-gray-400"
                }`}
              >
                {useHtml ? "HTML" : "Plain text"}
              </button>
            </div>
            <Textarea
              id="email-body"
              placeholder={useHtml ? "<h1>Hello!</h1><p>Your token was deployed.</p>" : "Hello! Your token was deployed successfully."}
              value={body}
              onChange={(e) => { setBody(e.target.value); syncConfig({ text: e.target.value }) }}
              rows={5}
              className="font-mono text-xs"
            />
          </div>

          {/* CC */}
          <div className="space-y-1">
            <Label htmlFor="email-cc" className="text-xs font-medium">CC</Label>
            <Input
              id="email-cc"
              placeholder="team@example.com"
              value={cc}
              onChange={(e) => { setCc(e.target.value); syncConfig({ cc: e.target.value }) }}
            />
          </div>

          {/* BCC */}
          <div className="space-y-1">
            <Label htmlFor="email-bcc" className="text-xs font-medium">BCC</Label>
            <Input
              id="email-bcc"
              placeholder="audit@example.com"
              value={bcc}
              onChange={(e) => { setBcc(e.target.value); syncConfig({ bcc: e.target.value }) }}
            />
          </div>

          {/* Reply-To */}
          <div className="space-y-1">
            <Label htmlFor="email-reply" className="text-xs font-medium">Reply-To</Label>
            <Input
              id="email-reply"
              placeholder="support@example.com"
              value={replyTo}
              onChange={(e) => { setReplyTo(e.target.value); syncConfig({ replyTo: e.target.value }) }}
            />
          </div>

          {/* Send result banner */}
          {sendResult && (
            <div
              className={`flex items-start gap-2 p-2 rounded-md text-xs ${
                sendResult.success
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {sendResult.success ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span className="break-all">{sendResult.message}</span>
            </div>
          )}

          {/* AI hint */}
          <div className="p-2 rounded-md bg-blue-50 border border-blue-200 text-[10px] text-blue-700">
            💡 Tip: You can also ask the AI chatbot to compose and send emails for you. Just say something like &quot;Send an email to alice@example.com about the token deployment.&quot;
          </div>
        </div>

        {/* Send button */}
        <div className="pt-3 border-t mt-3">
          <Button
            onClick={handleSendEmail}
            disabled={sending || !to}
            className="w-full"
          >
            {sending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Send className="h-4 w-4" /> Send Email
              </span>
            )}
          </Button>
        </div>
      </div>
    )
  }

  // ── Default config panel for other tools ──
  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Tool Information</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 flex-1 overflow-y-auto">
        <div className="space-y-2">
          <Label htmlFor="tool-name">Tool Name</Label>
          <div className="p-3 bg-gray-100 rounded-md">
            <p className="text-sm font-medium">{node.data.label || node.type || "Unknown"}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tool-id">Tool ID</Label>
          <div className="p-3 bg-gray-100 rounded-md">
            <p className="text-sm font-mono">{node.type || "N/A"}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, CheckCircle } from "lucide-react"
import { usePrivy } from "@privy-io/react-auth"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { isValidAIWorkflowResponse, aiResponseToWorkflow } from "@/lib/ai-workflow-converter"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  aiResponse?: any // Store the AI response if it's a workflow
}

interface AIChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplyWorkflow?: (nodes: any[], edges: any[]) => void
}

export function AIChatModal({ open, onOpenChange, onApplyWorkflow }: AIChatModalProps) {
  const { user, authenticated } = usePrivy()
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm here to help you create an agent workflow. Describe what you'd like to build, and I'll help you create it.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [currentAIResponse, setCurrentAIResponse] = useState<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus textarea when modal opens
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [open])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    
    // Check authentication and quota first
    if (!authenticated || !user?.id) {
      const aiMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: "Please connect your wallet to use AI generation.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMessage])
      return
    }

    // Check quota before generating
    try {
      const quotaResponse = await fetch(`/api/payments/ai-quota?userId=${user.id}`)
      const quota = await quotaResponse.json()
      
      if (!quota.canGenerate) {
        const aiMessage: Message = {
          id: Date.now().toString(),
          role: "assistant",
          content: "You've used all 3 free AI generations for today. Please use a paid generation to continue.",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, aiMessage])
        return
      }
    } catch (error) {
      console.error('Error checking quota:', error)
    }

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
    setCurrentAIResponse(null)

    try {
      const workflowBackendUrl = process.env.NEXT_PUBLIC_AI_WORKFLOW_BACKEND_URL || 'http://localhost:8001'
      const response = await fetch(`${workflowBackendUrl}/create-workflow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: userQuery,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      // Check if it's a valid workflow response
      if (isValidAIWorkflowResponse(data)) {
        // Increment usage count after successful generation
        try {
          await fetch('/api/payments/ai-quota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, isPaid: false })
          })
        } catch (error) {
          console.error('Error incrementing AI usage:', error)
        }

        setCurrentAIResponse(data)
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Here is your agent flow:\n\n${data.description || 'Workflow generated successfully'}\n\nTools: ${data.tools.map((t: any) => t.name || t.type).join(', ')}`,
          timestamp: new Date(),
          aiResponse: data,
        }
        setMessages((prev) => [...prev, aiMessage])
      } else {
        // Regular text response
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.message || data.content || "I received your request, but couldn't generate a workflow. Please try again.",
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, aiMessage])
      }
    } catch (error: any) {
      console.error('Error calling AI workflow API:', error)
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${error.message || 'Failed to generate workflow'}. Please try again.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyWorkflow = (aiResponse: any) => {
    if (!aiResponse || !onApplyWorkflow) return

    try {
      const { nodes, edges } = aiResponseToWorkflow(aiResponse)
      onApplyWorkflow(nodes, edges)
      setCurrentAIResponse(null)
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error applying workflow:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-2xl flex-col p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Create with AI</DialogTitle>
          <DialogDescription>
            Describe your workflow and We'll help you build it
          </DialogDescription>
        </DialogHeader>

        {/* Messages area - scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-4",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/10">
                    <Bot className="h-4 w-4 text-foreground" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-2.5",
                    message.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>
                  {message.aiResponse && (
                    <div className="mt-3 pt-3 border-t border-gray-300/50">
                      <Button
                        onClick={() => handleApplyWorkflow(message.aiResponse)}
                        size="sm"
                        className="w-full"
                        variant="default"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Apply the flow
                      </Button>
                    </div>
                  )}
                  <span className="mt-1 block text-xs opacity-70">
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {message.role === "user" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-4 justify-start">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/10">
                  <Bot className="h-4 w-4 text-foreground" />
                </div>
                <div className="bg-muted text-muted-foreground max-w-[80%] rounded-lg px-4 py-2.5">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                    <div className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                    <div className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>

        {/* Input area - fixed at bottom */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the workflow you want to create..."
              className="min-h-[60px] max-h-[120px] resize-none"
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="h-[60px] w-[60px] shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}


"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Copy, Check } from "lucide-react"
import { useState } from "react"
import { toast } from "@/components/ui/use-toast"

export default function ApiDocs() {
  const [copiedItem, setCopiedItem] = useState<string | null>(null)

  const handleCopy = (text: string, itemId: string) => {
    navigator.clipboard.writeText(text)
    setCopiedItem(itemId)
    setTimeout(() => setCopiedItem(null), 2000)
    toast({
      title: "Copied",
      description: "Code copied to clipboard",
    })
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <Button asChild variant="ghost" className="mb-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </Button>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            API Documentation
          </h1>
          <p className="text-muted-foreground text-lg">
            Learn how to integrate BlockOps agents into your applications
          </p>
        </div>

        {/* Content */}
        <div className="space-y-8">
          {/* Getting Started */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Getting Started</h2>
            <p className="text-muted-foreground">
              To use your BlockOps agent via API, you'll need your agent's API key. 
              You can find this by going to <Link href="/my-agents" className="text-blue-500 hover:underline">My Agents</Link>, 
              clicking on an agent, and selecting "Export".
            </p>
          </section>

          {/* API Key Documentation */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">What is the API Key?</h2>
            <div className="p-4 bg-muted border rounded-lg">
              <p className="text-muted-foreground leading-relaxed">
                The API key is a unique 32-character identifier that authenticates requests to your agent. 
                It's automatically generated when you create an agent and allows external applications to 
                interact with your agent programmatically.
              </p>
            </div>
          </section>

          {/* How to Use */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">How to Use</h2>
            <div className="p-4 bg-muted border rounded-lg">
              <ol className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">1.</span>
                  <span><strong>Get your agent configuration</strong> including the tools array</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">2.</span>
                  <span><strong>Include tools array</strong> as the <code className="bg-background px-2 py-1 rounded border">tools</code> parameter</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">3.</span>
                  <span><strong>Send POST requests</strong> to <code className="bg-background px-2 py-1 rounded border">http://localhost:8000/agent/chat</code></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">4.</span>
                  <span><strong>Receive responses</strong> with agent replies and tool execution results</span>
                </li>
              </ol>
            </div>
          </section>

          {/* Request Parameters */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Request Parameters</h2>
            <div className="p-4 bg-muted border rounded-lg space-y-4">
              <div className="border-b border-border pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <code className="bg-background px-3 py-1 rounded border font-semibold">tools</code>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200">required</span>
                </div>
                <p className="text-sm text-muted-foreground">Array of tool objects with tool name and next_tool (array)</p>
              </div>
              <div className="border-b border-border pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <code className="bg-background px-3 py-1 rounded border font-semibold">user_message</code>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded border border-red-200">required</span>
                </div>
                <p className="text-sm text-muted-foreground">The message/instruction you want to send to the agent (string)</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="bg-background px-3 py-1 rounded border font-semibold">private_key</code>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded border border-green-200">optional</span>
                </div>
                <p className="text-sm text-muted-foreground">Your wallet private key for blockchain operations (string)</p>
              </div>
            </div>
          </section>

          {/* cURL Example */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">cURL Example</h2>
            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg border overflow-x-auto text-sm">
                <code>{`curl -X POST http://localhost:8000/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "tools": [
      {"tool": "deploy_erc20", "next_tool": null}
    ],
    "user_message": "Deploy a token called MyToken",
    "private_key": "YOUR_PRIVATE_KEY"
  }'`}</code>
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => handleCopy(`curl -X POST http://localhost:8000/agent/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "tools": [
      {"tool": "deploy_erc20", "next_tool": null}
    ],
    "user_message": "Deploy a token called MyToken",
    "private_key": "YOUR_PRIVATE_KEY"
  }'`, "curl")}
              >
                {copiedItem === "curl" ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-foreground" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* JavaScript Example */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">JavaScript Example</h2>
            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg border overflow-x-auto text-sm">
                <code>{`const response = await fetch('http://localhost:8000/agent/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    tools: [
      { tool: 'deploy_erc20', next_tool: null }
    ],
    user_message: 'Deploy a token called MyToken',
    private_key: 'YOUR_PRIVATE_KEY'
  })
});

const data = await response.json();
console.log(data);`}</code>
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => handleCopy(`const response = await fetch('http://localhost:8000/agent/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    tools: [
      { tool: 'deploy_erc20', next_tool: null }
    ],
    user_message: 'Deploy a token called MyToken',
    private_key: 'YOUR_PRIVATE_KEY'
  })
});

const data = await response.json();
console.log(data);`, "javascript")}
              >
                {copiedItem === "javascript" ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-foreground" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* Response Format */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Response Format</h2>
            <div className="p-4 bg-muted rounded-lg border">
              <pre className="text-sm overflow-x-auto">
                <code>{`{
  "agent_response": "The agent's response text...",
  "tool_calls": [
    {
      "tool": "tool_name",
      "parameters": { ... }
    }
  ],
  "results": [
    {
      "success": true,
      "tool": "tool_name",
      "result": { ... }
    }
  ]
}`}</code>
              </pre>
            </div>
          </section>

          {/* Response Structure Details */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Response Structure</h2>
            <div className="p-4 bg-muted border rounded-lg space-y-3">
              <div>
                <code className="bg-background px-3 py-1 rounded border font-semibold">agent_response</code>
                <p className="mt-2 text-sm text-muted-foreground">The agent's natural language response to your message</p>
              </div>
              <div>
                <code className="bg-background px-3 py-1 rounded border font-semibold">tool_calls</code>
                <p className="mt-2 text-sm text-muted-foreground">Array of tools the agent called during execution</p>
              </div>
              <div>
                <code className="bg-background px-3 py-1 rounded border font-semibold">results</code>
                <p className="mt-2 text-sm text-muted-foreground">Array of results from each tool execution</p>
              </div>
            </div>
          </section>

          {/* Security Best Practices */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Security Best Practices</h2>
            <div className="p-4 bg-muted border rounded-lg">
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">•</span>
                  <span><strong>Never expose</strong> your API key in client-side code or public repositories</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">•</span>
                  <span><strong>Store securely</strong> in environment variables or secure vaults</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">•</span>
                  <span><strong>Don't share</strong> your API key publicly or commit it to version control</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold shrink-0">•</span>
                  <span><strong>Rotate regularly</strong> by deleting and recreating your agent if compromised</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Rate Limits */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Rate Limits & Usage</h2>
            <div className="p-4 bg-muted border rounded-lg">
              <p className="text-muted-foreground leading-relaxed">
                Each API key is unique to your agent. Monitor your usage through the agent dashboard. 
                For high-volume applications, consider implementing client-side rate limiting and error handling 
                to ensure reliable operation.
              </p>
            </div>
          </section>

          {/* Next Steps */}
          <section className="space-y-4 pb-8">
            <h2 className="text-2xl font-bold">Next Steps</h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild size="lg">
                <Link href="/my-agents">
                  View My Agents
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/agent-builder">
                  Create New Agent
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

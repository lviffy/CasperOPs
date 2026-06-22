"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Loader2, Search, Wallet, AlertCircle, CheckCircle2, ExternalLink, Send, ArrowRight, ChevronDown, BookOpen, PenLine, MessageSquare } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import { useAuth } from "@/lib/auth"
import { signDeploy, sendDeploy, casperDeployUrl } from "@/lib/wallet"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import ReactMarkdown from "react-markdown"
import {
  discoverContract,
  executeNaturalLanguageCommand,
  askContractQuestion,
} from "@/lib/contract-backend"
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID, explorerUrl } from "@/lib/chains"

interface ContractFunction {
  index?: number
  name: string
  type: string
  signature?: string
  stateMutability: string
  inputs: Array<{
    name: string
    type: string
  }>
  outputs: Array<{
    name: string
    type: string
  }>
}

interface ContractInteractionProps {
  onInteraction?: (contractHash: string, entryPoint: string, params: any[]) => void
}

const CONTRACT_HASH_RE = /^(hash-[a-f0-9]{64}|[a-f0-9]{64})$/i

export function ContractInteraction({ onInteraction }: ContractInteractionProps) {
  const { user, dbUser, csprclickPublicKey, isWalletLogin } = useAuth()
  const publicKey = csprclickPublicKey ?? user?.publicKey ?? null
  const [contractHash, setContractHash] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [contractABI, setContractABI] = useState<any[] | null>(null)
  const [showManualABI, setShowManualABI] = useState(false)
  const [manualABI, setManualABI] = useState("")
  const [functions, setFunctions] = useState<{
    read: ContractFunction[]
    write: ContractFunction[]
  }>({ read: [], write: [] })
  const [functionParams, setFunctionParams] = useState<Record<string, string[]>>({})
  const [executingFunction, setExecutingFunction] = useState<string | null>(null)
  const [functionResults, setFunctionResults] = useState<Record<string, any>>({})

  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([])
  const [chatInput, setChatInput] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [useBackendDiscovery, setUseBackendDiscovery] = useState(true)
  const [executionPlan, setExecutionPlan] = useState<any>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages, isChatLoading])

  const isValidContractHash = (value: string) => CONTRACT_HASH_RE.test(value.trim())

  const fetchContractABI = async () => {
    if (!isValidContractHash(contractHash)) {
      toast({
        title: "Invalid Contract Hash",
        description: "Expected a Casper contract hash (hash-<64 hex> or 64 hex chars).",
        variant: "destructive",
      })
      return
    }

    const normalized = contractHash.trim().toLowerCase().startsWith("hash-")
      ? contractHash.trim().toLowerCase()
      : `hash-${contractHash.trim().toLowerCase()}`

    setIsLoading(true)
    setShowManualABI(false)
    setContractABI(null)
    setFunctions({ read: [], write: [] })

    let loaded = false

    if (useBackendDiscovery) {
      try {
        const response = await discoverContract(normalized)
        if (response.success && response.data) {
          const { allFunctions, totalFunctions } = response.data

          const funcs: ContractFunction[] = allFunctions.map((func) => ({
            index: func.index,
            name: func.name,
            type: 'function',
            signature: func.signature,
            stateMutability: func.stateMutability,
            inputs: func.inputs,
            outputs: func.outputs,
          }))

          const abi = funcs.map((func) => ({
            name: func.name,
            type: func.type,
            stateMutability: func.stateMutability,
            inputs: func.inputs,
            outputs: func.outputs,
          }))

          setContractABI(abi)
          parseFunctions(abi)
          loaded = true

          toast({
            title: "Contract Loaded",
            description: `${totalFunctions} entry points discovered`,
          })
        }
      } catch (backendError: any) {
        console.warn("Backend discovery failed:", backendError?.message)
      }
    }

    if (!loaded) {
      setShowManualABI(true)
      toast({
        title: "Contract Not Indexed",
        description: "Paste the entry-point schema (JSON ABI) manually to interact with this contract.",
        variant: "destructive",
      })
    }

    setIsLoading(false)
  }

  const parseFunctions = (abi: any[]) => {
    const readFunctions: ContractFunction[] = []
    const writeFunctions: ContractFunction[] = []

    abi.forEach((item) => {
      if (item.type === "function") {
        const func: ContractFunction = {
          name: item.name,
          type: item.type,
          stateMutability: item.stateMutability,
          inputs: item.inputs || [],
          outputs: item.outputs || [],
        }

        if (item.stateMutability === "view" || item.stateMutability === "pure") {
          readFunctions.push(func)
        } else {
          writeFunctions.push(func)
        }
      }
    })

    setFunctions({ read: readFunctions, write: writeFunctions })
  }

  const handleManualABI = () => {
    try {
      const abi = JSON.parse(manualABI)
      setContractABI(abi)
      parseFunctions(abi)
      setShowManualABI(false)
      toast({
        title: "ABI Loaded",
        description: "Contract entry points loaded successfully from manual input",
      })
    } catch {
      toast({
        title: "Invalid ABI",
        description: "Please enter a valid JSON ABI",
        variant: "destructive",
      })
    }
  }

  const handleParamChange = (functionName: string, index: number, value: string) => {
    setFunctionParams((prev) => {
      const params = [...(prev[functionName] || [])]
      params[index] = value
      return { ...prev, [functionName]: params }
    })
  }

  const casperStateRpcUrl = () => `${CHAIN_CONFIGS[DEFAULT_CHAIN_ID].rpcUrl.replace(/\/$/, "")}/rpc`

  const executeReadFunction = async (func: ContractFunction) => {
    if (!contractABI) return

    setExecutingFunction(func.name)
    try {
      const rawParams = functionParams[func.name] || []
      const params = rawParams.map((value) => value)

      const stateRoot = await globalThis.fetch
        ? null
        : null

      const rpcBody = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "query_global_state",
        params: {
          contract_hash: contractHash.startsWith("hash-") ? contractHash : `hash-${contractHash}`,
          key: func.name,
          ...(params.length > 0 ? { args: params } : {}),
        },
      }

      const res = await fetch(casperStateRpcUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpcBody),
      })

      if (!res.ok) {
        throw new Error(`RPC returned ${res.status}`)
      }

      const data: any = await res.json()
      const displayResult = data?.result ? JSON.stringify(data.result, null, 2) : "OK"

      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: true, result: displayResult },
      }))

      toast({
        title: "Entry Point Queried",
        description: `${func.name} returned a value`,
      })

      if (onInteraction) {
        onInteraction(contractHash, func.name, params)
      }
    } catch (error: any) {
      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: false, error: error.message || error.toString() },
      }))
      toast({
        title: "Query Failed",
        description: error.message || "Failed to query entry point",
        variant: "destructive",
      })
    } finally {
      setExecutingFunction(null)
    }
  }

  const executeWriteFunction = async (func: ContractFunction) => {
    if (!contractABI) return
    if (!publicKey) {
      toast({
        title: "Wallet Required",
        description: "Connect a Casper wallet via CSPR.click to invoke write entry points",
        variant: "destructive",
      })
      return
    }

    setExecutingFunction(func.name)
    try {
      const rawParams = functionParams[func.name] || []
      const params = rawParams.map((value) => value)

      const deployJson = {
        contractHash: contractHash.startsWith("hash-") ? contractHash : `hash-${contractHash}`,
        entryPoint: func.name,
        args: params,
        signingPublicKey: publicKey,
        chainName: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
      }

      const signed = await signDeploy(deployJson as any, publicKey)

      const deployHash =
        (signed as any)?.deployHash ??
        (signed as any)?.deploy_hash ??
        (signed as any)?.hash ??
        ""

      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: {
          success: true,
          result: deployHash,
          txHash: deployHash,
        },
      }))

      toast({
        title: "Deploy Signed",
        description: "Broadcast the signed deploy via CSPR.click or your RPC endpoint.",
      })

      if (deployHash) {
        toast({
          title: "Explorer",
          description: casperDeployUrl(deployHash),
        })
      }

      if (onInteraction) {
        onInteraction(contractHash, func.name, params)
      }
    } catch (error: any) {
      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: false, error: error.message || String(error) },
      }))
      toast({
        title: "Signing Failed",
        description: error.message || "Failed to sign deploy",
        variant: "destructive",
      })
    } finally {
      setExecutingFunction(null)
    }
  }

  const handleAIChatSubmit = async () => {
    if (!chatInput.trim() || !contractABI) return

    const userMessage = chatInput.trim()
    setChatInput("")
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsChatLoading(true)

    try {
      const executionKeywords = /\b(call|execute|run|invoke|send|transfer|approve|mint|burn|swap|deposit|withdraw|stake|unstake|claim|set|update|change|modify)\b/i
      const isExecutionCommand = executionKeywords.test(userMessage) && !userMessage.trim().endsWith('?')

      if (isExecutionCommand) {
        if (!publicKey) {
          setChatMessages((prev) => [...prev, {
            role: 'assistant',
            content: 'Connect a Casper wallet via CSPR.click to execute entry points. You can still ask questions without a signer.',
          }])
          setIsChatLoading(false)
          return
        }

        const planResponse = await executeNaturalLanguageCommand(
          contractHash,
          userMessage,
          { walletType: 'csprclick', publicKey },
          false,
        )

        if (planResponse.success && planResponse.data?.executionPlan) {
          const plan = planResponse.data.executionPlan
          setExecutionPlan(plan)

          let planMessage = `I've analyzed your request:\n\n`
          planMessage += `**Entry Point:** ${plan.functionName}\n`
          planMessage += `**Type:** ${plan.isReadOnly ? 'Read-Only' : 'Write (requires deploy)'}\n\n`

          if (plan.parameters && plan.parameters.length > 0) {
            planMessage += `**Parameters:**\n`
            plan.parameters.forEach((param: any) => {
              planMessage += `- ${param.name} (${param.type}): ${param.rawValue}\n`
            })
            planMessage += `\n`
          }

          planMessage += `**Reasoning:** ${plan.reasoning}\n\n`
          planMessage += `Reply with "yes" or "execute" to sign the deploy.`

          setChatMessages((prev) => [...prev, { role: 'assistant', content: planMessage }])
        } else if (planResponse.data?.message) {
          setChatMessages((prev) => [...prev, { role: 'assistant' as const, content: String(planResponse.data.message) }])
        } else {
          setChatMessages((prev) => [...prev, {
            role: 'assistant',
            content: planResponse.message || 'I couldn\'t process that request. Try asking about a specific entry point.',
          }])
        }
      } else {
        const chatResponse = await askContractQuestion(
          contractHash,
          userMessage,
          contractABI,
          chatMessages.slice(-10),
        )

        if (chatResponse.success && chatResponse.data?.answer) {
          setChatMessages((prev) => [...prev, { role: 'assistant', content: chatResponse.data.answer }])
        } else {
          setChatMessages((prev) => [...prev, {
            role: 'assistant',
            content: chatResponse.message || 'I couldn\'t answer that question. Try rephrasing.',
          }])
        }
      }
    } catch (error: any) {
      setChatMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${error.message}`,
      }])
    } finally {
      setIsChatLoading(false)
    }
  }

  const handleExecuteConfirmation = async () => {
    if (!executionPlan || !publicKey) return

    setIsChatLoading(true)
    setChatMessages((prev) => [...prev, { role: 'user', content: 'yes, execute' }])

    try {
      const deployJson = {
        contractHash: contractHash.startsWith("hash-") ? contractHash : `hash-${contractHash}`,
        entryPoint: executionPlan.functionName,
        args: (executionPlan.parameters || []).map((p: any) => p.rawValue),
        signingPublicKey: publicKey,
        chainName: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
      }

      const sent = await sendDeploy(deployJson as any, publicKey, true)
      const deployHash =
        (sent as any)?.deployHash ??
        (sent as any)?.deploy_hash ??
        (sent as any)?.hash ??
        ''

      const resultMessage = `Deploy broadcasted!\n\n**Deploy Hash:** ${deployHash}\n**Explorer:** ${casperDeployUrl(deployHash)}`

      setChatMessages((prev) => [...prev, { role: 'assistant', content: resultMessage }])
      setExecutionPlan(null)

      toast({
        title: "Deploy Broadcasted",
        description: casperDeployUrl(deployHash),
      })
    } catch (error: any) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `Execution failed: ${error.message}` }])
    } finally {
      setIsChatLoading(false)
    }
  }

  const renderFunctionCard = (func: ContractFunction, isWrite: boolean) => {
    const result = functionResults[func.name]
    const isExecuting = executingFunction === func.name
    const hasWallet = !!publicKey

    return (
      <AccordionItem key={func.name} value={func.name} className="border-b last:border-b-0">
        <AccordionTrigger className="hover:no-underline py-3 text-sm">
          <div className="flex items-center gap-2 text-left">
            <span className="font-medium font-mono">{func.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal">
              {func.stateMutability}
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-3 pt-1 pb-2">
            {func.inputs.length > 0 && (
              <div className="space-y-2">
                {func.inputs.map((input, index) => (
                  <div key={index} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {input.name || `param${index}`}
                      <span className="ml-1 font-mono text-[10px] opacity-60">{input.type}</span>
                    </Label>
                    <Input
                      placeholder={`Enter ${input.type}`}
                      value={functionParams[func.name]?.[index] || ""}
                      onChange={(e) => handleParamChange(func.name, index, e.target.value)}
                      disabled={isExecuting}
                      className="h-8 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => isWrite ? executeWriteFunction(func) : executeReadFunction(func)}
              disabled={isExecuting || (isWrite && !hasWallet)}
              className="w-full h-8 text-xs"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <ArrowRight className="mr-1.5 size-3" />
                  Execute
                </>
              )}
            </Button>

            {isWrite && !hasWallet && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Wallet className="size-3" />
                Connect a Casper wallet to execute write entry points
              </p>
            )}

            {result && (
              <div className={`rounded-md border p-3 text-xs ${result.success ? 'bg-muted/50' : 'border-destructive/30 bg-destructive/5'}`}>
                {result.success ? (
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Result</p>
                    <p className="font-mono break-all">{result.result}</p>
                    {result.txHash && (
                      <a
                        href={casperDeployUrl(result.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors mt-1"
                      >
                        View on Explorer <ExternalLink className="size-2.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-destructive text-[10px] uppercase tracking-wider">Error</p>
                    <p className="break-all text-destructive/80">{result.error}</p>
                  </div>
                )}
              </div>
            )}

            {func.outputs.length > 0 && (
              <p className="text-[10px] text-muted-foreground font-mono">
                → {func.outputs.map((output, idx) => (
                  <span key={idx}>
                    {output.name || `output${idx}`}: {output.type}
                    {idx < func.outputs.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Contract Hash</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enter a Casper contract hash to explore its entry points
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="hash-..."
            value={contractHash}
            onChange={(e) => setContractHash(e.target.value)}
            disabled={isLoading}
            className="font-mono text-sm"
          />
          <Button
            variant="outline"
            onClick={fetchContractABI}
            disabled={isLoading || !contractHash}
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Search className="mr-2 size-4" />
                Load
              </>
            )}
          </Button>
        </div>

        {showManualABI && (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className="size-3" />
              Manual ABI Input
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="size-3" />
                <AlertDescription className="text-xs">
                  Contract not indexed. Paste the entry-point schema (JSON ABI) below.
                </AlertDescription>
              </Alert>
              <Textarea
                placeholder='[{"inputs":[],"name":"entry_point","outputs":[],...}]'
                value={manualABI}
                onChange={(e) => setManualABI(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
              <Button variant="outline" size="sm" onClick={handleManualABI} className="w-full">
                Load ABI
              </Button>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>

      {contractABI && (
        <>
          <Separator />

          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="size-3.5" />
                AI Assistant
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Describe what you want to do with the contract
              </p>
            </div>

            <div className="rounded-md border">
              <div ref={chatScrollRef} className="max-h-72 overflow-y-auto">
                {chatMessages.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      Try: &quot;What does this contract do?&quot; or &quot;Invoke the transfer entry point&quot;
                    </p>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-md px-3 py-2 text-xs ${
                            msg.role === 'user'
                              ? 'bg-foreground text-background'
                              : 'bg-muted'
                          }`}
                        >
                          {msg.role === 'assistant' ? (
                            <div className="prose prose-xs dark:prose-invert max-w-none break-words leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:my-2 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:my-1.5 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:my-1 [&_code]:text-[10px] [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:text-[10px] [&_pre]:bg-background/50 [&_pre]:p-2 [&_pre]:rounded [&_hr]:my-2 [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-md px-3 py-2">
                          <Loader2 className="size-3 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t p-3 space-y-2">
                {executionPlan && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExecuteConfirmation}
                    disabled={isChatLoading || !publicKey}
                    className="w-full h-8 text-xs"
                  >
                    <CheckCircle2 className="mr-1.5 size-3" />
                    Confirm &amp; Sign Deploy
                  </Button>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask AI about the contract..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAIChatSubmit()
                      }
                    }}
                    disabled={isChatLoading}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 size-8"
                    onClick={handleAIChatSubmit}
                    disabled={!chatInput.trim() || isChatLoading}
                  >
                    <Send className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Entry Points</h2>
              <span className="text-xs text-muted-foreground">
                {functions.read.length + functions.write.length} total
              </span>
            </div>

            <Tabs defaultValue="read" className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="read" className="text-xs gap-1.5">
                  <BookOpen className="size-3" />
                  Read ({functions.read.length})
                </TabsTrigger>
                <TabsTrigger value="write" className="text-xs gap-1.5">
                  <PenLine className="size-3" />
                  Write ({functions.write.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="read" className="mt-3">
                {functions.read.length > 0 ? (
                  <Accordion type="single" collapsible className="w-full">
                    {functions.read.map((func) => renderFunctionCard(func, false))}
                  </Accordion>
                ) : (
                  <p className="text-center py-10 text-sm text-muted-foreground">
                    No read entry points found
                  </p>
                )}
              </TabsContent>
              <TabsContent value="write" className="mt-3">
                {functions.write.length > 0 ? (
                  <Accordion type="single" collapsible className="w-full">
                    {functions.write.map((func) => renderFunctionCard(func, true))}
                  </Accordion>
                ) : (
                  <p className="text-center py-10 text-sm text-muted-foreground">
                    No write entry points found
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </>
      )}
    </div>
  )
}

export default ContractInteraction

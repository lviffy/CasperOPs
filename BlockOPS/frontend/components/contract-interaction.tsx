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
import { ethers } from "ethers"
import { useAuth } from "@/lib/auth"
import { decryptStoredPrivateKey, hasStoredSigningKey } from "@/lib/lit-private-key"
import { hasConfiguredAgentWallet, hasStoredPkpWallet, signTransactionWithPkp } from "@/lib/lit-pkp"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import ReactMarkdown from "react-markdown"
import { 
  discoverContract, 
  executeNaturalLanguageCommand,
  askContractQuestion 
} from "@/lib/contract-backend"

// Extend Window interface for ethereum
declare global {
  interface Window {
    ethereum?: any
  }
}

interface ContractFunction {
  index?: number
  name: string
  type: string
  signature?: string
  stateMutability: string
  inputs: Array<{
    name: string
    type: string
    internalType?: string
  }>
  outputs: Array<{
    name: string
    type: string
    internalType?: string
  }>
}

interface ContractInteractionProps {
  onInteraction?: (address: string, functionName: string, params: any[]) => void
}

export function ContractInteraction({ onInteraction }: ContractInteractionProps) {
  const { dbUser, privyWalletAddress, isWalletLogin } = useAuth()
  const [contractAddress, setContractAddress] = useState("")
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
  
  // AI Chat states
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

  const isValidAddress = (address: string) => {
    // Normalize to lowercase first to avoid EIP-55 checksum rejections
    return ethers.isAddress(address.toLowerCase())
  }

  const fetchContractABI = async () => {
    if (!isValidAddress(contractAddress)) {
      toast({
        title: "Invalid Address",
        description: "Please enter a valid contract address",
        variant: "destructive",
      })
      return
    }

    // Normalize address to lowercase to avoid EIP-55 checksum issues throughout
    const normalizedAddress = contractAddress.toLowerCase()

    setIsLoading(true)
    setShowManualABI(false)
    setContractABI(null)
    setFunctions({ read: [], write: [] })

    let loaded = false

    // 1) Try backend discovery first
    if (useBackendDiscovery) {
      try {
        const response = await discoverContract(normalizedAddress)

        if (response.success && response.data) {
          const { allFunctions, totalFunctions } = response.data

          const funcs: ContractFunction[] = allFunctions.map(func => ({
            index: func.index,
            name: func.name,
            type: 'function',
            signature: func.signature,
            stateMutability: func.stateMutability,
            inputs: func.inputs,
            outputs: func.outputs,
          }))

          const abi = funcs.map(func => ({
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
            description: `${totalFunctions} functions discovered`,
          })
        }
      } catch (backendError: any) {
        console.warn("Backend discovery failed, trying Etherscan fallback:", backendError.message)
      }
    }

    // 2) Fallback: direct Etherscan API (Arbitrum Sepolia)
    if (!loaded) {
      try {
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"
        )

        const code = await provider.getCode(normalizedAddress)

        if (code === "0x") {
          toast({
            title: "Contract Not Found",
            description: "No contract deployed at this address on Arbitrum Sepolia",
            variant: "destructive",
          })
          setIsLoading(false)
          return
        }

        const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || "YourApiKeyToken"
        const apiUrl = `https://api.etherscan.io/v2/api?chainid=421614&module=contract&action=getabi&address=${normalizedAddress}&apikey=${apiKey}`

        const response = await fetch(apiUrl)
        const data = await response.json()

        if (data.status === "1" && data.result) {
          const abi = JSON.parse(data.result)
          setContractABI(abi)
          parseFunctions(abi)
          loaded = true
          toast({
            title: "Contract Loaded",
            description: `${abi.length} functions loaded`,
          })
        }
      } catch (etherscanError: any) {
        console.warn("Etherscan fallback also failed:", etherscanError.message)
      }
    }

    // 3) Nothing worked — show manual ABI input
    if (!loaded) {
      setShowManualABI(true)
      toast({
        title: "Contract Not Verified",
        description: "Paste the ABI manually to interact with this contract.",
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

    console.log("Functions parsed:", { read: readFunctions.length, write: writeFunctions.length })
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
        description: "Contract ABI loaded successfully from manual input",
      })
    } catch (error) {
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

  const resolveAgentSigningContext = async () => {
    if (!dbUser) {
      return null
    }

    if (hasStoredPkpWallet(dbUser)) {
      return {
        walletType: "pkp" as const,
        pkpPublicKey: dbUser.pkp_public_key,
        pkpTokenId: dbUser.pkp_token_id,
      }
    }

    const decryptedPrivateKey = await decryptStoredPrivateKey(dbUser.private_key)
    if (!decryptedPrivateKey) {
      return null
    }

    return {
      walletType: "traditional" as const,
      privateKey: decryptedPrivateKey,
    }
  }

  // Helper function to convert parameter values based on type
  const convertParamValue = (value: string, type: string): any => {
    if (!value || value.trim() === "") return value

    try {
      // Handle arrays
      if (type.includes('[]')) {
        // If it's already a stringified array, parse it
        if (value.startsWith('[')) {
          return JSON.parse(value)
        }
        // Otherwise split by comma
        return value.split(',').map(v => v.trim())
      }

      // Handle boolean
      if (type === 'bool') {
        return value.toLowerCase() === 'true'
      }

      // Handle integers/uints
      if (type.match(/^u?int\d*$/)) {
        return BigInt(value)
      }

      // Handle bytes
      if (type.startsWith('bytes')) {
        return value
      }

      // Handle address
      if (type === 'address') {
        return value.trim()
      }

      // Default: return as string
      return value
    } catch (error) {
      console.warn(`Failed to convert param value "${value}" for type "${type}":`, error)
      return value
    }
  }

  const executeReadFunction = async (func: ContractFunction) => {
    if (!contractABI) return

    setExecutingFunction(func.name)
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"
      )
      const contract = new ethers.Contract(contractAddress, contractABI, provider)

      // Convert parameters based on their types
      const rawParams = functionParams[func.name] || []
      const params = rawParams.map((value, index) => 
        convertParamValue(value, func.inputs[index]?.type || 'string')
      )

      console.log("Executing read:", func.name, params)
      const result = await contract[func.name](...params)

      // Convert result to string for display
      let displayResult: string
      if (typeof result === 'object' && result !== null) {
        if (result._isBigNumber || typeof result === 'bigint') {
          displayResult = result.toString()
        } else if (Array.isArray(result)) {
          displayResult = JSON.stringify(result.map(r => 
            (r._isBigNumber || typeof r === 'bigint') ? r.toString() : r
          ), null, 2)
        } else {
          displayResult = JSON.stringify(result, null, 2)
        }
      } else {
        displayResult = String(result)
      }

      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: true, result: displayResult },
      }))

      toast({
        title: "Function Executed",
        description: `${func.name} executed successfully`,
      })

      if (onInteraction) {
        onInteraction(contractAddress, func.name, params)
      }
    } catch (error: any) {
      console.error("Error executing function:", error)
      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: false, error: error.message || error.toString() },
      }))
      toast({
        title: "Execution Failed",
        description: error.message || "Failed to execute function",
        variant: "destructive",
      })
    } finally {
      setExecutingFunction(null)
    }
  }

  const executeWriteFunction = async (func: ContractFunction) => {
    // Check if user has either agent wallet or Privy wallet
    const hasTraditionalAgentWallet = hasStoredSigningKey(dbUser?.private_key)
    const hasPkpAgentWallet = hasStoredPkpWallet(dbUser)
    const hasAgentWallet = hasTraditionalAgentWallet || hasPkpAgentWallet
    const hasPrivyWallet = isWalletLogin && privyWalletAddress
    
    if (!contractABI || (!hasAgentWallet && !hasPrivyWallet)) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet to execute write functions",
        variant: "destructive",
      })
      return
    }

    setExecutingFunction(func.name)
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"
      )
      
      let contract: ethers.Contract
      
      if (hasTraditionalAgentWallet) {
        const decryptedPrivateKey = await decryptStoredPrivateKey(dbUser?.private_key)
        if (!decryptedPrivateKey) {
          throw new Error("No valid agent wallet key found. Please set up your wallet again.")
        }

        const wallet = new ethers.Wallet(decryptedPrivateKey, provider)
        contract = new ethers.Contract(contractAddress, contractABI, wallet)
      } else if (hasPkpAgentWallet && dbUser?.wallet_address && dbUser?.pkp_public_key) {
        const rawParams = functionParams[func.name] || []
        const params = rawParams.map((value, index) => 
          convertParamValue(value, func.inputs[index]?.type || 'string')
        )
        const functionSignature = `${func.name}(${func.inputs.map((input) => input.type).join(",")})`
        const contractInterface = new ethers.Interface(contractABI)
        const data = contractInterface.encodeFunctionData(functionSignature, params)
        const gasEstimate = await provider.estimateGas({
          from: dbUser.wallet_address,
          to: contractAddress,
          data,
        })
        const gasLimit = (gasEstimate * BigInt(12)) / BigInt(10)
        const feeData = await provider.getFeeData()
        const nonce = await provider.getTransactionCount(dbUser.wallet_address, "pending")

        console.log("Executing write with PKP:", func.name, params)

        toast({
          title: "Transaction Sent",
          description: "Broadcasting with your Lit PKP signer...",
        })

        const pkpResult = await signTransactionWithPkp({
          pkpPublicKey: dbUser.pkp_public_key,
          pkpTokenId: dbUser.pkp_token_id,
          transaction: {
            to: contractAddress,
            data,
            gas: gasLimit.toString(),
            maxFeePerGas: feeData.maxFeePerGas?.toString() ?? feeData.gasPrice?.toString() ?? null,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() ?? null,
            nonce,
          },
        })

        setFunctionResults((prev) => ({
          ...prev,
          [func.name]: { 
            success: true, 
            result: pkpResult.hash,
            txHash: pkpResult.hash 
          },
        }))

        toast({
          title: "Transaction Confirmed",
          description: `${func.name} executed successfully with your PKP wallet.`,
        })

        if (onInteraction) {
          onInteraction(contractAddress, func.name, params)
        }

        return
      } else if (hasPrivyWallet && window.ethereum) {
        try {
          const browserProvider = new ethers.BrowserProvider(window.ethereum)
          const signer = await browserProvider.getSigner()
          contract = new ethers.Contract(contractAddress, contractABI, signer)
        } catch (providerError) {
          throw new Error("Failed to connect to wallet. Please ensure your wallet is connected.")
        }
      } else {
        throw new Error("No wallet available. Please connect your wallet first.")
      }

      // Convert parameters based on their types
      const rawParams = functionParams[func.name] || []
      const params = rawParams.map((value, index) => 
        convertParamValue(value, func.inputs[index]?.type || 'string')
      )

      console.log("Executing write:", func.name, params)
      const tx = await contract[func.name](...params)
      
      toast({
        title: "Transaction Sent",
        description: "Waiting for confirmation...",
      })

      const receipt = await tx.wait()

      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { 
          success: true, 
          result: receipt.hash,
          txHash: receipt.hash 
        },
      }))

      toast({
        title: "Transaction Confirmed",
        description: `${func.name} executed successfully`,
      })

      if (onInteraction) {
        onInteraction(contractAddress, func.name, params)
      }
    } catch (error: any) {
      console.error("Error executing function:", error)
      setFunctionResults((prev) => ({
        ...prev,
        [func.name]: { success: false, error: error.message },
      }))
      toast({
        title: "Transaction Failed",
        description: error.message || "Failed to execute function",
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
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsChatLoading(true)

    try {
      // Detect if this is an execution command or an informational question
      const executionKeywords = /\b(call|execute|run|invoke|send|transfer|approve|mint|burn|swap|deposit|withdraw|stake|unstake|claim|set|update|change|modify)\b/i
      const isExecutionCommand = executionKeywords.test(userMessage) && !userMessage.trim().endsWith('?')

      if (isExecutionCommand) {
        // --- Execution flow - requires the stored agent wallet (traditional or PKP) ---
        const signingContext = await resolveAgentSigningContext()

        if (!signingContext) {
          setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: 'Please set up your agent wallet to execute contract functions. You can still ask questions about the contract without a signer.' 
          }])
          setIsChatLoading(false)
          return
        }

        const planResponse = await executeNaturalLanguageCommand(
          contractAddress,
          userMessage,
          signingContext,
          false
        )

        if (planResponse.success && planResponse.data?.executionPlan) {
          const plan = planResponse.data.executionPlan
          setExecutionPlan(plan)
          
          let planMessage = `I've analyzed your request:\n\n`
          planMessage += `**Function:** ${plan.functionName}\n`
          planMessage += `**Signature:** ${plan.signature}\n`
          planMessage += `**Type:** ${plan.isReadOnly ? 'Read-Only' : 'Write (requires transaction)'}\n\n`
          
          if (plan.parameters && plan.parameters.length > 0) {
            planMessage += `**Parameters:**\n`
            plan.parameters.forEach((param: any) => {
              planMessage += `- ${param.name} (${param.type}): ${param.rawValue}\n`
            })
            planMessage += `\n`
          }
          
          planMessage += `**Reasoning:** ${plan.reasoning}\n\n`
          planMessage += `Would you like me to execute this? Reply with "yes" or "execute" to proceed.`
          
          setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: planMessage 
          }])
        } else if (planResponse.data?.message) {
          setChatMessages(prev => [...prev, { 
            role: 'assistant' as const, 
            content: String(planResponse.data.message)
          }])
        } else {
          setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: planResponse.message || 'I couldn\'t process that request. Try asking about a specific function.' 
          }])
        }
      } else {
        // --- Question/Chat flow (new) - no wallet needed ---
        const chatResponse = await askContractQuestion(
          contractAddress,
          userMessage,
          contractABI,
          chatMessages.slice(-10) // Send last 10 messages for context
        )

        if (chatResponse.success && chatResponse.data?.answer) {
          setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: chatResponse.data.answer 
          }])
        } else {
          setChatMessages(prev => [...prev, { 
            role: 'assistant', 
            content: chatResponse.message || 'I couldn\'t answer that question. Try rephrasing.' 
          }])
        }
      }
    } catch (error: any) {
      console.error('AI Chat error:', error)
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Error: ${error.message}` 
      }])
    } finally {
      setIsChatLoading(false)
    }
  }

  // Handle execution confirmation
  const handleExecuteConfirmation = async () => {
    if (!executionPlan) return

    setIsChatLoading(true)
    setChatMessages(prev => [...prev, { role: 'user', content: 'yes, execute' }])

    try {
      const signingContext = await resolveAgentSigningContext()
      if (!signingContext) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: 'No valid signer found. Please set up your wallet again before execution.',
        }])
        return
      }

      // Execute with confirmation
      const execResponse = await executeNaturalLanguageCommand(
        contractAddress,
        `Execute ${executionPlan.functionName}`, // Command doesn't matter now, backend uses plan
        signingContext,
        true // Confirm execution
      )

      if (execResponse.success && execResponse.data) {
        let resultMessage = '✓ Execution successful!\n\n'
        
        if (execResponse.data.transaction) {
          const tx = execResponse.data.transaction
          resultMessage += `**Transaction Hash:** ${tx.hash}\n`
          resultMessage += `**Block Number:** ${tx.blockNumber}\n`
          resultMessage += `**Gas Used:** ${tx.gasUsed}\n`
          resultMessage += `**Status:** ${tx.status}\n`
          resultMessage += `**Explorer:** [View on Arbiscan](${tx.explorerUrl})`
        } else if (execResponse.data.result) {
          resultMessage += `**Result:** ${execResponse.data.result}`
        }
        
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: resultMessage 
        }])
        setExecutionPlan(null)
        
        toast({
          title: "Execution Successful",
          description: "Function executed via natural language",
        })
      }
    } catch (error: any) {
      console.error('Execution error:', error)
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Execution failed: ${error.message}` 
      }])
    } finally {
      setIsChatLoading(false)
    }
  }

  const renderFunctionCard = (func: ContractFunction, isWrite: boolean) => {
    const result = functionResults[func.name]
    const isExecuting = executingFunction === func.name
    const hasWallet = hasConfiguredAgentWallet(dbUser) || (isWalletLogin && privyWalletAddress)

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
                Connect wallet to execute write functions
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
                        href={`${process.env.NEXT_PUBLIC_EXPLORER_URL || "https://sepolia.etherscan.io"}/tx/${result.txHash}`}
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
      {/* Contract Address Input */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Contract Address</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Enter a verified contract address to explore its functions
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="0x..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            disabled={isLoading}
            className="font-mono text-sm"
          />
          <Button
            variant="outline"
            onClick={fetchContractABI}
            disabled={isLoading || !contractAddress}
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
                  Contract not verified. Paste the ABI below.
                </AlertDescription>
              </Alert>
              <Textarea
                placeholder='[{"inputs":[],"name":"functionName","outputs":[],...}]'
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

          {/* AI Chat */}
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
              {/* Messages */}
              <div ref={chatScrollRef} className="max-h-72 overflow-y-auto">
                {chatMessages.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">
                      Try: &quot;What does this contract do?&quot; or &quot;Call the transfer function&quot;
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

              {/* Input */}
              <div className="border-t p-3 space-y-2">
                {executionPlan && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExecuteConfirmation}
                    disabled={isChatLoading}
                    className="w-full h-8 text-xs"
                  >
                    <CheckCircle2 className="mr-1.5 size-3" />
                    Confirm &amp; Execute
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

          {/* Functions */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Functions</h2>
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
                    No read functions found
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
                    No write functions found
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

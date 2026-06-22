/**
 * Contract Backend Service
 * 
 * This module provides utilities for interacting with the blockchain backend's
 * Natural Language Executor endpoints for smart contract interaction.
 */

import { BLOCKCHAIN_BACKEND_URL, BLOCKCHAIN_API_KEY } from './backend'
import type { WalletType } from './supabase'

/**
 * Contract Function Interface
 */
export interface ContractFunction {
  index: number
  name: string
  signature: string
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

/**
 * Contract Discovery Response
 */
export interface ContractDiscoveryResponse {
  success: boolean
  data: {
    contractAddress: string
    totalFunctions: number
    readFunctions: string[]
    writeFunctions: string[]
    allFunctions: ContractFunction[]
  }
  message?: string
}

/**
 * Execution Plan
 */
export interface ExecutionPlan {
  contractAddress: string
  functionName: string
  signature: string
  parameters: Array<{
    name: string
    type: string
    rawValue: string
    formattedValue: string
  }>
  reasoning: string
  isReadOnly: boolean
}

/**
 * Command Execution Response
 */
export interface CommandExecutionResponse {
  success: boolean
  data: {
    message?: string
    executionPlan: ExecutionPlan
    confirmation?: string
    result?: string
    type?: string
    transaction?: {
      hash: string
      blockNumber: number
      gasUsed: string
      status: string
      explorerUrl: string
    }
  }
  message?: string
  error?: string
}

/**
 * Discover contract functions from a contract address
 * Calls GET /nl-executor/discover/:contractAddress
 */
export async function discoverContract(
  contractAddress: string
): Promise<ContractDiscoveryResponse> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/nl-executor/discover/${contractAddress}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': BLOCKCHAIN_API_KEY,
      },
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ 
      error: 'Failed to discover contract' 
    }))
    // Use details field if available (contains more specific error message)
    const errorMessage = errorData.details || errorData.error || errorData.message || `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return response.json()
}

/**
 * Execute a natural language command on a contract
 * Calls POST /nl-executor/execute
 */
export async function executeNaturalLanguageCommand(
  contractAddress: string,
  command: string,
  signingContext: {
    privateKey?: string
    walletType?: WalletType | null
    pkpPublicKey?: string | null
    pkpTokenId?: string | null
  },
  confirmExecution: boolean = false,
  decimals: number = 18
): Promise<CommandExecutionResponse> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/nl-executor/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': BLOCKCHAIN_API_KEY,
      },
      body: JSON.stringify({
        contractAddress,
        command,
        privateKey: signingContext.privateKey,
        walletType: signingContext.walletType,
        pkpPublicKey: signingContext.pkpPublicKey,
        pkpTokenId: signingContext.pkpTokenId,
        confirmExecution,
        decimals,
      }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ 
      error: 'Failed to execute command' 
    }))
    // Use details field if available (contains more specific error message)
    const errorMessage = errorData.details || errorData.error || errorData.message || `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return response.json()
}

/**
 * Quick execute a natural language command (auto-confirm)
 * Calls POST /nl-executor/quick-execute
 * Use with caution - automatically executes without confirmation
 */
export async function quickExecuteCommand(
  contractAddress: string,
  command: string,
  signingContext: {
    privateKey?: string
    walletType?: WalletType | null
    pkpPublicKey?: string | null
    pkpTokenId?: string | null
  },
  decimals: number = 18
): Promise<CommandExecutionResponse> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/nl-executor/quick-execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': BLOCKCHAIN_API_KEY,
      },
      body: JSON.stringify({
        contractAddress,
        command,
        privateKey: signingContext.privateKey,
        walletType: signingContext.walletType,
        pkpPublicKey: signingContext.pkpPublicKey,
        pkpTokenId: signingContext.pkpTokenId,
        decimals,
      }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ 
      error: 'Failed to execute command' 
    }))
    // Use details field if available (contains more specific error message)
    const errorMessage = errorData.details || errorData.error || errorData.message || `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return response.json()
}

/**
 * Helper to format function parameters for display
 */
export function formatFunctionSignature(func: ContractFunction): string {
  const inputs = func.inputs
    .map(input => `${input.name || 'param'}: ${input.type}`)
    .join(', ')
  
  const outputs = func.outputs && func.outputs.length > 0
    ? ' -> ' + func.outputs.map(output => output.type).join(', ')
    : ''
  
  return `${func.name}(${inputs})${outputs}`
}

/**
 * Helper to categorize functions by type
 */
export function categorizeFunctions(functions: ContractFunction[]): {
  read: ContractFunction[]
  write: ContractFunction[]
} {
  const read = functions.filter(f => 
    f.stateMutability === 'view' || f.stateMutability === 'pure'
  )
  const write = functions.filter(f => 
    f.stateMutability !== 'view' && f.stateMutability !== 'pure'
  )
  
  return { read, write }
}

/**
 * Contract Chat Response
 */
export interface ContractChatResponse {
  success: boolean
  data: {
    answer: string
    contractAddress: string
    question: string
  }
  message?: string
  error?: string
}

/**
 * Ask AI a question about a loaded contract
 * Calls POST /contract-chat/ask
 */
export async function askContractQuestion(
  contractAddress: string,
  question: string,
  abi: any[],
  chatHistory: Array<{ role: string; content: string }> = []
): Promise<ContractChatResponse> {
  const response = await fetch(
    `${BLOCKCHAIN_BACKEND_URL}/contract-chat/ask`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contractAddress,
        question,
        abi,
        chatHistory,
      }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ 
      error: 'Failed to get answer' 
    }))
    const errorMessage = errorData.details || errorData.error || errorData.message || `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return response.json()
}

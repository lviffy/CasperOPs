const { ethers } = require('ethers');
const axios = require('axios');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { 
  ETHERSCAN_V2_BASE_URL, 
  ARBITRUM_SEPOLIA_CHAIN_ID, 
  ETHERSCAN_API_KEY,
  GROQ_API_KEY,
  GEMINI_API_KEY,
  OPENAI_API_KEY 
} = require('../config/constants');
const { getProvider, getWallet, getContract } = require('../utils/blockchain');
const { 
  successResponse, 
  errorResponse, 
  validateRequiredFields,
  getTxExplorerUrl,
  logTransaction 
} = require('../utils/helpers');
const {
  deriveWalletAddressFromPkpPublicKey,
  signAndBroadcastTransactionWithPkp
} = require('../services/litPkpService');

// Initialize AI clients
let groqClient = null;
if (GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: GROQ_API_KEY });
  console.log('✓ Groq client initialized for NL Executor (Primary)');
}

/**
 * Fetch Contract ABI from Etherscan V2 API
 * @param {string} contractAddress - The contract address to fetch ABI for
 * @returns {Promise<Array>} Contract ABI
 */
async function fetchContractABI(contractAddress) {
  if (!ETHERSCAN_API_KEY) {
    throw new Error('ETHERSCAN_API_KEY not configured in environment variables');
  }

  const url = ETHERSCAN_V2_BASE_URL;
  const params = {
    chainid: ARBITRUM_SEPOLIA_CHAIN_ID,
    module: 'contract',
    action: 'getabi',
    address: contractAddress,
    apikey: ETHERSCAN_API_KEY
  };

  try {
    const response = await axios.get(url, { params });
    
    if (response.data.status === '0') {
      throw new Error(response.data.result || 'Failed to fetch ABI from Etherscan');
    }

    const abi = JSON.parse(response.data.result);
    return abi;
  } catch (error) {
    if (error.response) {
      throw new Error(`Etherscan API error: ${error.response.data?.result || error.message}`);
    }
    throw error;
  }
}

/**
 * Parse and format functions from ABI
 * @param {Array} abi - Contract ABI
 * @returns {Array} Formatted function list
 */
function parseFunctionsFromABI(abi) {
  const functions = abi.filter(item => item.type === 'function');
  
  return functions.map((func, index) => {
    const inputs = func.inputs
      .map(input => `${input.name || 'param'}: ${input.type}`)
      .join(', ');
    
    const outputs = func.outputs && func.outputs.length > 0
      ? ' -> ' + func.outputs.map(output => output.type).join(', ')
      : '';
    
    return {
      index: index + 1,
      name: func.name,
      signature: `${func.name} (${inputs})${outputs}`,
      stateMutability: func.stateMutability,
      inputs: func.inputs,
      outputs: func.outputs
    };
  });
}

/**
 * Use AI (Gemini/OpenAI) to map natural language to function call
 * @param {string} userCommand - Natural language command
 * @param {Array} functions - Available functions
 * @param {string} contractAddress - Contract address for context
 * @returns {Promise<Object>} Matched function and parameters
 */
async function mapCommandToFunction(userCommand, functions, contractAddress) {
  // Build the prompt for AI
  const functionsList = functions.map(f => 
    `[${f.index}] ${f.signature} (${f.stateMutability})`
  ).join('\n');

  const prompt = `You are a smart contract interaction assistant. Given a list of available contract functions and a user's natural language command, determine which function to call and extract the parameters.

Contract Address: ${contractAddress}
Available Functions:
${functionsList}

User Command: "${userCommand}"

Analyze the command and respond ONLY with a JSON object in this exact format:
{
  "functionName": "exact_function_name",
  "reasoning": "brief explanation of why this function matches",
  "parameters": [
    {
      "name": "parameter_name",
      "type": "parameter_type",
      "value": "extracted_value"
    }
  ],
  "needsDecimalConversion": true/false,
  "decimals": 18
}

Important rules:
1. For token amounts, if user says "100 tokens" and it's an ERC20, set needsDecimalConversion=true with decimals=18
2. Extract addresses in full format (0x...)
3. Convert numeric strings to proper format based on type (uint256, etc.)
4. If the command is unclear or missing information, set "error" field with explanation
5. Match function names exactly as they appear in the list

Respond ONLY with the JSON object, no other text.`;

  try {
    let aiResponse;

    // Try Groq first (Primary)
    if (groqClient) {
      try {
        const completion = await groqClient.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
          response_format: { type: 'json_object' }
        });
        
        aiResponse = completion.choices[0].message.content;
        console.log('AI response from Groq (Primary)');
      } catch (groqError) {
        console.error('Groq failed, trying fallbacks:', groqError.message);
      }
    }
    
    // Fallback to Gemini
    if (!aiResponse && GEMINI_API_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        aiResponse = response.text();
        console.log('AI response from Gemini (Fallback)');
      } catch (geminiError) {
        console.error('Gemini failed:', geminiError.message);
      }
    }
    
    // Final fallback to OpenAI
    if (!aiResponse && OPENAI_API_KEY) {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });
      
      aiResponse = completion.choices[0].message.content;
      console.log('AI response from OpenAI (Fallback)');
    }
    
    if (!aiResponse) {
      throw new Error('No AI API key configured. Please set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in environment variables.');
    }

    // Parse AI response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI response did not contain valid JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  } catch (error) {
    throw new Error(`AI mapping failed: ${error.message}`);
  }
}

/**
 * Convert parameters to proper format for contract call
 * @param {Array} parameters - Parameters from AI mapping
 * @param {Object} functionInputs - Function input definitions from ABI
 * @param {boolean} needsDecimalConversion - Whether to apply decimal conversion
 * @param {number} decimals - Number of decimals for conversion
 * @returns {Array} Formatted parameters ready for contract call
 */
function formatParameters(parameters, functionInputs, needsDecimalConversion = false, decimals = 18) {
  return parameters.map((param, index) => {
    const inputDef = functionInputs[index];
    const paramType = inputDef.type;

    let value = param.value;

    // Handle decimal conversion for token amounts
    if (needsDecimalConversion && (paramType === 'uint256' || paramType.startsWith('uint'))) {
      // Check if this looks like a token amount (not already in wei format)
      if (value.toString().length < 18) {
        value = ethers.parseUnits(value.toString(), decimals).toString();
      }
    }

    // Type conversions
    if (paramType === 'address') {
      return ethers.getAddress(value); // Validate and checksum address
    } else if (paramType === 'uint256' || paramType.startsWith('uint')) {
      return BigInt(value);
    } else if (paramType === 'int256' || paramType.startsWith('int')) {
      return BigInt(value);
    } else if (paramType === 'bool') {
      return value === 'true' || value === true;
    } else if (paramType === 'bytes' || paramType.startsWith('bytes')) {
      return value;
    } else if (paramType === 'string') {
      return value.toString();
    }

    return value;
  });
}

/**
 * Discovery Phase: Get Contract Functions
 * GET /nl-executor/discover/:contractAddress
 */
async function discoverContract(req, res) {
  try {
    const { contractAddress } = req.params;

    // Validate contract address (normalize to lowercase to avoid EIP-55 checksum rejections)
    if (!ethers.isAddress(contractAddress.toLowerCase())) {
      return res.status(400).json(
        errorResponse('Invalid contract address format')
      );
    }

    logTransaction('Contract Discovery', { contractAddress });

    // Fetch ABI from Etherscan
    const abi = await fetchContractABI(contractAddress);
    
    // Parse functions
    const functions = parseFunctionsFromABI(abi);

    // Categorize functions
    const readFunctions = functions.filter(f => 
      f.stateMutability === 'view' || f.stateMutability === 'pure'
    );
    const writeFunctions = functions.filter(f => 
      f.stateMutability !== 'view' && f.stateMutability !== 'pure'
    );

    return res.json(
      successResponse({
        contractAddress,
        totalFunctions: functions.length,
        readFunctions: readFunctions.map(f => `[${f.index}] ${f.signature}`),
        writeFunctions: writeFunctions.map(f => `[${f.index}] ${f.signature}`),
        allFunctions: functions
      }, 'Contract functions discovered successfully')
    );

  } catch (error) {
    console.error('Discovery error:', error);
    
    // Provide better error messages for common issues
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.message.includes('Contract source code not verified')) {
      errorMessage = 'Contract source code is not verified on Etherscan. To use this contract, please verify it on Arbiscan (https://sepolia.arbiscan.io) or use a verified contract address.';
      statusCode = 400;
    } else if (error.message.includes('ETHERSCAN_API_KEY not configured')) {
      errorMessage = 'Etherscan API key is not configured. Please set ETHERSCAN_API_KEY in environment variables.';
      statusCode = 500;
    }
    
    return res.status(statusCode).json(
      errorResponse('Failed to discover contract', errorMessage)
    );
  }
}

/**
 * Execution Phase: Execute Natural Language Command
 * POST /nl-executor/execute
 */
async function executeCommand(req, res) {
  try {
    const { 
      contractAddress, 
      command, 
      privateKey,
      walletAddress,
      walletType,
      pkpPublicKey,
      pkpTokenId,
      confirmExecution = false,
      decimals = 18
    } = req.body;

    // Validate required fields
    const validationError = validateRequiredFields(req.body, [
      'contractAddress', 
      'command'
    ]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Validate contract address (normalize to lowercase to avoid EIP-55 checksum rejections)
    if (!ethers.isAddress(contractAddress.toLowerCase())) {
      return res.status(400).json(
        errorResponse('Invalid contract address format')
      );
    }

    logTransaction('NL Command Execution', { contractAddress, command });

    // Step 1: Fetch ABI
    const abi = await fetchContractABI(contractAddress);
    const functions = parseFunctionsFromABI(abi);

    // Step 2: Map command to function using AI
    const mapping = await mapCommandToFunction(command, functions, contractAddress);
    
    // Find the function definition
    const targetFunction = functions.find(f => f.name === mapping.functionName);
    if (!targetFunction) {
      return res.status(400).json(
        errorResponse('Function not found in contract', {
          suggestedFunction: mapping.functionName,
          availableFunctions: functions.map(f => f.name)
        })
      );
    }

    // Step 3: Format parameters
    const formattedParams = formatParameters(
      mapping.parameters,
      targetFunction.inputs,
      mapping.needsDecimalConversion,
      mapping.decimals || decimals
    );

    // Build execution plan
    const executionPlan = {
      contractAddress,
      functionName: mapping.functionName,
      signature: targetFunction.signature,
      parameters: mapping.parameters.map((p, i) => ({
        name: p.name,
        type: p.type,
        rawValue: p.value,
        formattedValue: formattedParams[i].toString()
      })),
      reasoning: mapping.reasoning,
      isReadOnly: targetFunction.stateMutability === 'view' || targetFunction.stateMutability === 'pure'
    };

    // If not confirmed, return the plan for user confirmation
    if (!confirmExecution) {
      return res.json(
        successResponse({
          message: 'Execution plan generated. Review and confirm to proceed.',
          executionPlan,
          confirmation: 'To execute, send the same request with "confirmExecution": true'
        }, 'Command mapped successfully')
      );
    }

    // Step 4: Execute the transaction
    const provider = getProvider();
    const isPkpWallet = walletType === 'pkp' && !!pkpPublicKey;
    const hasTraditionalSigner = !!privateKey;
    let wallet = null;
    let signerAddress = walletAddress || null;

    if (hasTraditionalSigner) {
      wallet = getWallet(privateKey, provider);
      signerAddress = signerAddress || wallet.address;
    } else if (isPkpWallet) {
      signerAddress = signerAddress || deriveWalletAddressFromPkpPublicKey(pkpPublicKey);
    }

    if (!executionPlan.isReadOnly && !wallet && !isPkpWallet) {
      return res.status(400).json(
        errorResponse(
          'Missing signer context',
          'Provide a traditional privateKey or a PKP wallet context (walletType="pkp" with pkpPublicKey).'
        )
      );
    }

    if (!executionPlan.isReadOnly && !signerAddress) {
      return res.status(400).json(
        errorResponse('Unable to resolve signer address for transaction execution')
      );
    }

    // Check balance
    const balance = !executionPlan.isReadOnly
      ? await provider.getBalance(signerAddress)
      : 0n;
    if (balance === 0n && !executionPlan.isReadOnly) {
      return res.status(400).json(
        errorResponse('Insufficient balance for gas fees', 
          'Please fund your wallet with ETH on Arbitrum Sepolia')
      );
    }

    // Create contract instance
    const contract = getContract(contractAddress, abi, wallet || provider);
    const contractMethod = contract[mapping.functionName];

    if (!contractMethod) {
      return res.status(500).json(
        errorResponse('Method not found on contract instance')
      );
    }

    // Execute based on function type
    if (executionPlan.isReadOnly) {
      // Read-only call (no transaction)
      const result = await contractMethod(...formattedParams);
      
      return res.json(
        successResponse({
          executionPlan,
          result: result.toString(),
          type: 'read-only'
        }, 'Read-only function executed successfully')
      );
    } else {
      // State-changing transaction
      let populatedTransaction = null;

      // Simulate first with staticCall
      try {
        if (wallet) {
          await contractMethod.staticCall(...formattedParams);
        } else {
          populatedTransaction = await contractMethod.populateTransaction(...formattedParams);
          await provider.call({
            ...populatedTransaction,
            from: signerAddress
          });
        }
      } catch (simulationError) {
        return res.status(400).json(
          errorResponse('Transaction simulation failed', {
            reason: simulationError.message,
            executionPlan
          })
        );
      }

      // Estimate gas
      let gasEstimate;
      let gasLimit;
      let feeData;
      try {
        if (wallet) {
          gasEstimate = await contractMethod.estimateGas(...formattedParams);
        } else {
          populatedTransaction = populatedTransaction || await contractMethod.populateTransaction(...formattedParams);
          gasEstimate = await provider.estimateGas({
            ...populatedTransaction,
            from: signerAddress
          });
        }
        gasLimit = gasEstimate * 12n / 10n;
        
        // Check if balance is sufficient for gas
        feeData = await provider.getFeeData();
        const effectiveGasPrice = feeData.maxFeePerGas || feeData.gasPrice;
        if (effectiveGasPrice) {
          const estimatedCost = gasLimit * effectiveGasPrice;
          if (balance < estimatedCost) {
            return res.status(400).json(
              errorResponse('Insufficient balance for gas fees', {
                balance: ethers.formatEther(balance),
                estimatedCost: ethers.formatEther(estimatedCost)
              })
            );
          }
        }
      } catch (estimateError) {
        console.warn('Gas estimation failed:', estimateError.message);
      }

      if (wallet) {
        // Send transaction with the legacy traditional key path
        const tx = gasLimit
          ? await contractMethod(...formattedParams, { gasLimit })
          : await contractMethod(...formattedParams);

        console.log('Transaction sent:', tx.hash);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log('Transaction confirmed in block:', receipt.blockNumber);

        return res.json(
          successResponse({
            executionPlan,
            transaction: {
              hash: tx.hash,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed.toString(),
              status: receipt.status === 1 ? 'success' : 'failed',
              explorerUrl: getTxExplorerUrl(tx.hash)
            }
          }, 'Transaction executed successfully')
        );
      }

      populatedTransaction = populatedTransaction || await contractMethod.populateTransaction(...formattedParams);
      const pkpTransaction = await signAndBroadcastTransactionWithPkp({
        pkpPublicKey,
        transaction: {
          to: populatedTransaction.to || contractAddress,
          data: populatedTransaction.data || null,
          value: populatedTransaction.value ? populatedTransaction.value.toString() : '0',
          gas: gasLimit ? gasLimit.toString() : null,
          maxFeePerGas: feeData?.maxFeePerGas ? feeData.maxFeePerGas.toString() : feeData?.gasPrice ? feeData.gasPrice.toString() : null,
          maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas.toString() : null,
          nonce: await provider.getTransactionCount(signerAddress, 'pending')
        }
      });

      return res.json(
        successResponse({
          executionPlan,
          transaction: {
            hash: pkpTransaction.hash,
            blockNumber: pkpTransaction.blockNumber,
            gasUsed: pkpTransaction.gasUsed,
            status: pkpTransaction.status,
            explorerUrl: pkpTransaction.explorerUrl,
            walletType: 'pkp',
            pkpTokenId: pkpTokenId || null
          }
        }, 'Transaction executed successfully')
      );
    }

  } catch (error) {
    console.error('Execution error:', error);
    
    // Provide better error messages for common issues
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.message.includes('Contract source code not verified')) {
      errorMessage = 'Contract source code is not verified on Etherscan. Please verify the contract or use a verified contract address.';
      statusCode = 400;
    } else if (error.message.includes('ETHERSCAN_API_KEY not configured')) {
      errorMessage = 'Etherscan API key is not configured. Please set ETHERSCAN_API_KEY in environment variables.';
      statusCode = 500;
    } else if (error.message.includes('No AI API key configured')) {
      errorMessage = 'No AI API key configured. Please set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.';
      statusCode = 500;
    }
    
    return res.status(statusCode).json(
      errorResponse('Failed to execute command', errorMessage)
    );
  }
}

/**
 * Quick Execute with Auto-confirmation (Use with caution)
 * POST /nl-executor/quick-execute
 */
async function quickExecute(req, res) {
  // Set confirmExecution to true automatically
  req.body.confirmExecution = true;
  return executeCommand(req, res);
}

module.exports = {
  discoverContract,
  executeCommand,
  quickExecute
};

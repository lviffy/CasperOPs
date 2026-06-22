const { chatWithAI } = require('./aiService');
const { detectReminderPlan } = require('./reminderIntent');

/**
 * Available tools in the system
 */
const AVAILABLE_TOOLS = {
  fetch_price: {
    name: 'fetch_price',
    description: 'Fetches the current price of any cryptocurrency (e.g., Bitcoin, Ethereum, Solana, etc.)',
    parameters: ['token_name'],
    examples: ['What is the price of Bitcoin?', 'How much is Solana worth?', 'Get me ETH price']
  },
  get_balance: {
    name: 'get_balance',
    description: 'Gets the native token balance of a wallet address on the selected chain. If the user asks for "my balance", the connected wallet address will be used automatically.',
    parameters: ['wallet_address (optional if user is asking for their own balance)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['What is the balance of 0x123...?', 'Check my wallet balance on Flow', 'How much FLOW do I have?']
  },
  transfer: {
    name: 'transfer',
    description: 'Transfers the selected chain native token or an ERC20 token from the user\'s connected wallet to another wallet. The user\'s wallet address is used automatically.',
    parameters: ['to_address', 'amount', 'token_address (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Send 1 FLOW to 0x123...', 'Transfer 100 USDC to Alice on Flow', 'Pay Bob 0.5 ETH on Arbitrum']
  },
  deploy_erc20: {
    name: 'deploy_erc20',
    description: 'Deploys a new ERC20 token contract on the selected chain (Flow EVM Testnet or Arbitrum Sepolia).',
    parameters: ['name', 'symbol', 'decimals', 'initial_supply', 'chain (optional, defaults to request chain)'],
    examples: ['Deploy a new token called MyToken on Flow', 'Create an ERC20 token on Arbitrum', 'Launch a new cryptocurrency']
  },
  deploy_erc721: {
    name: 'deploy_erc721',
    description: 'Deploys a new ERC721 NFT collection contract on the selected chain (Flow EVM Testnet or Arbitrum Sepolia).',
    parameters: ['name', 'symbol', 'base_uri', 'chain (optional, defaults to request chain)'],
    examples: ['Deploy an NFT collection on Flow', 'Create a new NFT project on Arbitrum', 'Launch an NFT collection']
  },
  mint_nft: {
    name: 'mint_nft',
    description: 'Mints a new NFT in an existing ERC721 collection',
    parameters: ['contract_address', 'to_address', 'token_uri'],
    examples: ['Mint an NFT', 'Create a new NFT in my collection', 'Mint token ID 5']
  },
  get_token_info: {
    name: 'get_token_info',
    description: 'Gets information about an ERC20 token (name, symbol, decimals, total supply)',
    parameters: ['token_address'],
    examples: ['Get info about token 0x123...', 'What is this token?', 'Token details for 0xabc...']
  },
  get_token_balance: {
    name: 'get_token_balance',
    description: 'Gets the balance of a specific ERC20 token for a wallet',
    parameters: ['wallet_address', 'token_address'],
    examples: ['How many USDC does 0x123... have?', 'Check my token balance', 'Token balance for wallet']
  },
  get_nft_info: {
    name: 'get_nft_info',
    description: 'Gets information about an NFT collection or specific NFT',
    parameters: ['contract_address', 'token_id (optional)'],
    examples: ['Get NFT collection info', 'What is this NFT?', 'NFT details for token #5']
  },
  calculate: {
    name: 'calculate',
    description: 'Performs mathematical calculations or conversions',
    parameters: ['expression', 'values'],
    examples: ['How much can I buy with X ETH?', 'Calculate 100 / 83.92', 'Convert ETH to tokens']
  },
  send_email: {
    name: 'send_email',
    description: 'Sends an email to one or more recipients. Supports plain text, HTML, CC, BCC, reply-to, and attachments.',
    parameters: ['to', 'subject', 'text (optional)', 'html (optional)', 'cc (optional)', 'bcc (optional)', 'replyTo (optional)'],
    examples: ['Send an email to alice@example.com', 'Email Bob the transaction receipt', 'Notify team about the deployment']
  },
  batch_transfer: {
    name: 'batch_transfer',
    description: 'Sends the selected chain native token to multiple wallet addresses in a single on-chain transaction (airdrop / multi-send). Requires a list of recipient addresses and amounts.',
    parameters: ['privateKey', 'recipients (array of {address, amount})', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Airdrop 0.1 FLOW to 5 wallets', 'Send FLOW to multiple addresses at once', 'Multi-send ETH on Arbitrum']
  },
  batch_mint: {
    name: 'batch_mint',
    description: 'Mints NFTs from a collection to multiple recipient addresses in sequence.',
    parameters: ['privateKey', 'collectionAddress', 'recipients (array of addresses)'],
    examples: ['Mint NFTs to 10 addresses', 'Airdrop NFTs to my list of holders', 'Batch mint to multiple wallets']
  },
  lookup_transaction: {
    name: 'lookup_transaction',
    description: 'Look up an on-chain transaction by its hash on the selected chain. Returns full details including status, gas used, value, decoded input, and revert reason if failed.',
    parameters: ['txHash', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Check the status of tx 0xabc...', 'Did this transaction succeed on Flow?', 'What happened in transaction 0x...']
  },
  fetch_events: {
    name: 'fetch_events',
    description: 'Fetch on-chain events (logs) emitted by a contract. Can filter by event signature and block range.',
    parameters: ['contractAddress', 'eventSignature (optional)', 'fromBlock (optional)', 'toBlock (optional)', 'limit (optional)'],
    examples: ['Get Transfer events for contract 0x...', 'Show me recent events from my token contract', 'Fetch Mint events from block 5000000']
  },
  lookup_block: {
    name: 'lookup_block',
    description: 'Get information about a specific block by number, or the latest block, on the selected chain.',
    parameters: ['blockNumber (or "latest")', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['What is the latest block?', 'Show me block 12345678', 'Get latest block info']
  },
  decode_revert: {
    name: 'decode_revert',
    description: 'Decode a revert reason from a failed transaction hash or raw revert data hex on the selected chain.',
    parameters: ['txHash (optional)', 'data (optional hex)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Why did transaction 0x... fail?', 'Decode this revert data: 0x08c379a0...', 'What is the revert reason for this tx?']
  },
  get_portfolio: {
    name: 'get_portfolio',
    description: 'Get a full portfolio breakdown for a wallet address. This remains Arbitrum Sepolia-only in the current build.',
    parameters: ['address'],
    examples: ['Show my portfolio for 0x...', 'What tokens does this wallet hold?', 'Get the total value of wallet 0x...']
  },
  resolve_ens: {
    name: 'resolve_ens',
    description: 'Resolve an ENS name (like vitalik.eth) to an Ethereum address, or do a reverse lookup of an address to its ENS name.',
    parameters: ['name (ENS name) OR address (for reverse lookup)'],
    examples: ['What address is vitalik.eth?', 'Resolve nick.eth', 'What ENS name does 0xd8dA6BF2... have?']
  },
  estimate_gas: {
    name: 'estimate_gas',
    description: 'Get current gas prices on the selected chain with slow/normal/fast fee tiers and estimated transaction costs.',
    parameters: ['chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['What are the current gas prices on Flow?', 'How much gas does a transfer cost right now?', 'Show me gas fee tiers']
  },
  simulate_gas: {
    name: 'simulate_gas',
    description: 'Estimate the gas units a specific contract call would use before sending it.',
    parameters: ['to', 'from (optional)', 'data or (abi + functionName + args)'],
    examples: ['How much gas would this transfer use?', 'Estimate gas for calling approve on 0x...', 'Simulate this contract call']
  },
  swap_tokens: {
    name: 'swap_tokens',
    description: 'Swap any ERC20 token pair (or ETH ↔ token) via Uniswap V3 on Arbitrum Sepolia. Fetches a live quote, applies slippage, and executes the swap.',
    parameters: ['privateKey', 'tokenIn (address or "ETH")', 'tokenOut (address or "ETH")', 'amountIn', 'slippageTolerance (optional, default 0.5)', 'fee (optional, 500|3000|10000, default 3000)'],
    examples: ['Swap 1 ETH for USDC', 'Exchange 100 USDC to WETH', 'Swap 0.5 WETH to ARB with 1% slippage']
  },
  get_swap_quote: {
    name: 'get_swap_quote',
    description: 'Get a dry-run Uniswap V3 quote for a token swap without sending any transaction. Returns expected output amount and slippage scenarios.',
    parameters: ['tokenIn (address or "ETH")', 'tokenOut (address or "ETH")', 'amountIn', 'fee (optional)'],
    examples: ['How much USDC will I get for 1 ETH?', 'Quote swapping 500 USDC to WETH', 'What is the price for 2 ETH to USDC on Uniswap?']
  },
  bridge_deposit: {
    name: 'bridge_deposit',
    description: 'Deposit ETH or ERC20 tokens from Ethereum Sepolia (L1) to Arbitrum Sepolia (L2) via the official Arbitrum bridge (Inbox contract).',
    parameters: ['privateKey', 'amount', 'tokenAddress (optional, omit for ETH)', 'destinationAddress (optional)'],
    examples: ['Bridge 0.1 ETH to Arbitrum', 'Deposit 100 USDC from Ethereum to Arbitrum Sepolia', 'Move ETH from L1 to L2']
  },
  bridge_withdraw: {
    name: 'bridge_withdraw',
    description: 'Initiate an ETH or ERC20 withdrawal from Arbitrum Sepolia (L2) back to Ethereum Sepolia (L1). Funds are claimable after the challenge window.',
    parameters: ['privateKey', 'amount', 'tokenAddress (optional, omit for ETH)', 'destinationAddress (optional)'],
    examples: ['Withdraw 0.1 ETH from Arbitrum to Ethereum', 'Bridge USDC back to L1', 'Move tokens from Arbitrum to Ethereum Sepolia']
  },
  bridge_status: {
    name: 'bridge_status',
    description: 'Check the status of a retryable ticket created by a bridge deposit. Returns ticket status (created/redeemed/expired) and L1/L2 confirmation details.',
    parameters: ['txHash (L1 deposit transaction hash)'],
    examples: ['What is the status of my bridge deposit 0x...?', 'Check if my bridged ETH has arrived on L2', 'Get retryable ticket status for tx 0x...']
  },
  schedule_transfer: {
    name: 'schedule_transfer',
    description: 'Schedule a one-time or recurring on-chain native token or ERC20 transfer using a cron expression, ISO datetime string, or relative timer phrase (for example, "in 5 minutes").',
    parameters: ['privateKey', 'toAddress', 'amount', 'cronExpression (cron string, ISO datetime, or relative timer phrase like "in 5 minutes")', 'tokenAddress (optional)', 'label (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Schedule a transfer of 0.01 FLOW every day at 9am', 'Send 100 USDC to 0x... every Monday on Flow', 'Schedule a one-time transfer at 2026-03-10T12:00:00Z']
  },
  create_savings_plan: {
    name: 'create_savings_plan',
    description: 'Create a recurring savings plan on the selected chain by scheduling automated deposits to a wallet, vault, or savings address.',
    parameters: ['privateKey', 'toAddress', 'amount', 'cronExpression', 'tokenAddress (optional)', 'label (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Save 5 FLOW every Friday', 'Create a weekly savings plan to 0x...', 'Auto-save 25 USDC each month']
  },
  schedule_payout: {
    name: 'schedule_payout',
    description: 'Create a recurring payout on the selected chain by scheduling automated transfers to a contributor, employee, or grant recipient.',
    parameters: ['privateKey', 'toAddress', 'amount', 'cronExpression', 'tokenAddress (optional)', 'label (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Pay a contributor 10 FLOW every month', 'Schedule a monthly grant payout to 0x...', 'Send 100 USDC on the first day of every month']
  },
  create_payroll_plan: {
    name: 'create_payroll_plan',
    description: 'Create a recurring payroll plan on Flow by scheduling salary or contributor payments to the same recipient on a fixed cadence.',
    parameters: ['privateKey', 'toAddress', 'amount', 'cronExpression', 'tokenAddress (optional)', 'label (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Pay a contributor 10 FLOW every month', 'Create a biweekly payroll plan for 0x...', 'Schedule salary payments on Flow']
  },
  create_grant_payout: {
    name: 'create_grant_payout',
    description: 'Create a recurring grant or stipend payout on Flow for community programs, creators, or ecosystem recipients.',
    parameters: ['privateKey', 'toAddress', 'amount', 'cronExpression', 'tokenAddress (optional)', 'label (optional)', 'chain (optional, defaults to Flow EVM Testnet)'],
    examples: ['Send a monthly grant payout of 25 FLOW', 'Create a stipend plan for 0x...', 'Schedule a recurring ecosystem grant on Flow']
  },
  get_flow_network_overview: {
    name: 'get_flow_network_overview',
    description: 'Show the Flow EVM Testnet setup used by BlockOPs, including chain id, explorer, faucet, sponsored gas status, and recommended Flow automation tools.',
    parameters: [],
    examples: ['How is Flow configured in this app?', 'Show me the Flow setup', 'Give me the Flow testnet overview']
  },
  get_flow_wallet_readiness: {
    name: 'get_flow_wallet_readiness',
    description: 'Check whether a wallet is ready for Flow automation by inspecting its Flow balance and returning faucet/explorer guidance.',
    parameters: ['wallet_address (optional if user is asking about their own wallet)'],
    examples: ['Is my Flow wallet ready?', 'Check whether 0x123... is funded on Flow', 'Do I need Flow faucet funds?']
  },
  schedule_reminder: {
    name: 'schedule_reminder',
    description: 'Schedule a one-time or recurring reminder that sends a balance update, wallet value snapshot, or token price back to the same chat.',
    parameters: ['taskType (balance|portfolio|price)', 'cronExpression (cron string or ISO datetime)', 'walletAddress (for balance/portfolio)', 'tokenQuery (for price)', 'label (optional)'],
    examples: ['Tell me my wallet balance after 5 minutes', 'Check my wallet value every 5 minutes', 'Send me the ETH price every hour']
  },
  list_reminders: {
    name: 'list_reminders',
    description: 'List scheduled reminder jobs for this user or agent.',
    parameters: [],
    examples: ['Show my reminders', 'List scheduled alerts', 'What reminders are active?']
  },
  cancel_reminder: {
    name: 'cancel_reminder',
    description: 'Cancel a scheduled reminder job by id.',
    parameters: ['id'],
    examples: ['Cancel reminder abc123', 'Stop schedule 123', 'Delete my wallet alert']
  },
  list_schedules: {
    name: 'list_schedules',
    description: 'List all scheduled transfers for this agent — shows cron expression, next run, status, and run count.',
    parameters: [],
    examples: ['Show my scheduled transfers', 'List all recurring jobs', 'What transfers are scheduled?']
  },
  cancel_schedule: {
    name: 'cancel_schedule',
    description: 'Cancel (delete) a scheduled transfer by its job ID.',
    parameters: ['id'],
    examples: ['Cancel scheduled job abc123', 'Stop the recurring transfer', 'Delete schedule id xyz']
  }
};

/**
 * Use AI to intelligently determine which tools to call and in what order
 * @param {string} userMessage - The user's natural language request
 * @param {Array} conversationHistory - Recent conversation messages for context
 * @returns {Promise<Object>} Tool execution plan with tools, order, and parameters
 */
async function intelligentToolRouting(userMessage, conversationHistory = [], routingContext = {}) {
  const reminderPlan = detectReminderPlan(userMessage, conversationHistory);
  if (reminderPlan) {
    return reminderPlan;
  }

  // Quick regex-based off-topic detection
  const offTopicPatterns = [
    /\b(prime minister|president|politician|government|election|politics)\b/i,
    /\b(weather|temperature|forecast|rain|sunny)\b/i,
    /\b(movie|film|actor|actress|celebrity|entertainment)\b/i,
    /\b(recipe|cooking|food|restaurant|cuisine)\b(?!.*token|contract)/i,
    /\b(sport|football|basketball|soccer|cricket|tennis)\b/i,
    /\b(health|medical|doctor|disease|medicine)\b/i,
    /\bwho is\b.*\b(minister|president|ceo|founder)\b(?!.*(vitalik|satoshi|blockchain|crypto))/i
  ];
  
  // Check if message matches off-topic patterns
  const isOffTopic = offTopicPatterns.some(pattern => pattern.test(userMessage));
  
  if (isOffTopic) {
    return {
      analysis: 'User query is not related to blockchain operations',
      is_off_topic: true,
      requires_tools: false,
      execution_plan: { type: 'none', steps: [] },
      missing_info: [],
      complexity: 'simple'
    };
  }
  
  const toolsList = Object.values(AVAILABLE_TOOLS)
    .map(tool => `- ${tool.name}: ${tool.description}\n  Parameters: ${tool.parameters.join(', ')}\n  Examples: ${tool.examples.join('; ')}`)
    .join('\n\n');

  // Build rich conversation context with extracted entities
  let conversationContext = '';
  if (conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-10);
    
    // Extract key entities from conversation history 
    const extractedEntities = [];
    for (const msg of recentMessages) {
      const content = msg.content || '';
      // Extract wallet addresses
      const addresses = content.match(/0x[a-fA-F0-9]{40}/g);
      if (addresses) extractedEntities.push(`Wallet addresses mentioned: ${addresses.join(', ')}`);
      // Extract ETH balances
      const balanceMatch = content.match(/(\d+\.?\d*)\s*ETH/i);
      if (balanceMatch) extractedEntities.push(`ETH balance found: ${balanceMatch[1]} ETH`);
      // Extract prices
      const priceMatches = content.match(/([A-Z]{2,10}):\s*([\d,.]+)\s*USD/gi);
      if (priceMatches) extractedEntities.push(`Prices found: ${priceMatches.join(', ')}`);
      // Extract tool results
      if (content.includes('Balance for')) extractedEntities.push(`Previous result: ${content}`);
      if (content.includes('Current prices:')) extractedEntities.push(`Previous result: ${content}`);
    }
    
    const entitySummary = extractedEntities.length > 0
      ? `\n\nKEY DATA FROM CONVERSATION (reuse this, do NOT ask user again):\n${[...new Set(extractedEntities)].join('\n')}`
      : '';
    
    conversationContext = `\n\nRecent conversation (last ${recentMessages.length} messages):\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}${entitySummary}`;
  }

  const prompt = `You are an intelligent tool routing system for a blockchain assistant. Your PRIMARY job is to create COMPLETE execution plans that resolve the user's request in a single pass, WITHOUT asking the user for information that your tools can fetch.

## Your Responsibilities:
1. Determine if the request is blockchain/crypto-related
2. Create a COMPLETE multi-step tool execution plan
3. Extract context from conversation history (addresses, balances, previous results)
4. Auto-resolve dependencies by chaining tools — NEVER ask the user for data a tool can provide
5. Only put truly user-dependent info in missing_info (private keys, destination addresses NOT in context)

## CRITICAL RULE — RESOLVE, DON'T ASK:
If the user's question requires data that a tool can fetch, ADD THAT TOOL TO THE PLAN.
- Need a price? → Add fetch_price step. Do NOT put "current ETH price" in missing_info.
- Need a balance? → Add get_balance step. Do NOT put "wallet balance" in missing_info.
- Need token info? → Add get_token_info step.
- "missing_info" is ONLY for things NO tool can resolve: private keys, unknown wallet addresses, ambiguous token names.

## CRITICAL RULE — USE CONVERSATION CONTEXT:
The conversation history contains previously fetched data. EXTRACT and REUSE it:
- If a wallet address was mentioned earlier, use it (don't ask again)
- If a balance was fetched, reference it in calculations
- If the user says "this balance" or "my balance", look for the address/balance in recent messages
- Pronouns like "it", "this", "that" refer to the most recent relevant entity

IMPORTANT: Off-topic detection — If the user's request is NOT related to blockchain operations or email notifications (e.g., general knowledge, weather, entertainment, politics), flag it as off-topic.

Available Tools:
${toolsList}

User Request: "${userMessage}"${conversationContext}

Analyze the request and respond with a JSON object following this structure:

{
  "analysis": "Brief explanation of what the user wants to accomplish",
  "is_off_topic": true/false,
  "requires_tools": true/false,
  "extracted_context": {
    "wallet_address": "address from conversation or null",
    "eth_balance": "balance from conversation or null",
    "referenced_tokens": ["tokens mentioned or implied"]
  },
  "execution_plan": {
    "type": "sequential" or "parallel",
    "steps": [
      {
        "tool": "tool_name",
        "reason": "why this tool is needed",
        "parameters": {
          "param_name": "extracted_value or null if needs to be provided by user"
        },
        "depends_on": ["tool_name"] or []
      }
    ]
  },
  "missing_info": ["ONLY info that NO tool can resolve AND is not in conversation context"],
  "complexity": "simple" or "moderate" or "complex"
}

## MANDATORY MULTI-STEP PATTERNS (follow these EXACTLY):

### "How many [TOKEN] can I buy with [X] ETH / my balance / this balance":
Steps (sequential):
1. get_balance (if balance not already known from context) with wallet address from context
2. fetch_price for "ethereum" (ALWAYS needed to convert ETH → USD)
3. fetch_price for the target token
4. calculate: (eth_balance * eth_price) / token_price
missing_info: [] (EMPTY — all data comes from tools)

### "What is my balance worth in USD":
1. get_balance (if not known)
2. fetch_price for "ethereum"
3. calculate: eth_balance * eth_price

### "Convert X [TOKEN_A] to [TOKEN_B]" / comparison:
1. fetch_price for token_a
2. fetch_price for token_b
3. calculate: (amount * price_a) / price_b

### "Send $X worth of ETH to [address]":
1. fetch_price for "ethereum"
2. calculate: usd_amount / eth_price
3. transfer with calculated amount

### Price query: Direct fetch_price call
### Balance query: Direct get_balance call

## KEY RULES:
1. Multi-part requests → create steps for ALL parts
2. Use "sequential" when one tool's output feeds another
3. Use "parallel" when tools are independent
4. Extract parameters from BOTH the current message AND conversation history
5. For ANY calculation involving prices/balances → add fetch_price + calculate steps
6. Ethereum addresses are 42 chars starting with "0x"
7. Request execution chain: ${routingContext.networkName || 'Flow EVM Testnet'} (Chain ID: ${routingContext.chainId || 545}). Treat this as authoritative unless the current user message explicitly names another supported chain.
8. When the user says "calculate" or "now calculate" after previous data was fetched, create a calculate step using the data from conversation context
9. If the user says generic words like "this balance" or "my balance", look for the wallet address and balance in recent conversation messages
10. NEVER put prices, balances, or token info in missing_info — those are fetchable by tools
11. Include "chain": "${routingContext.chain || 'flow-testnet'}" in blockchain tool parameters unless the current user message explicitly requested another supported chain. Never silently switch back to Flow if routingContext.chain is provided.

Respond ONLY with valid JSON, no other text.`;

  try {
    const messages = [
      {
        role: 'system',
        content: 'You are a JSON-only tool routing expert. Always respond with valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const response = await chatWithAI(messages, 'moonshotai/kimi-k2-instruct-0905', {
      temperature: 0.2, // Low temperature for more consistent routing
      maxTokens: 2000
    });

    // Extract JSON from response - try multiple patterns
    let jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      jsonMatch = response.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      throw new Error('AI response did not contain valid JSON');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const routingPlan = JSON.parse(jsonStr.trim());
    const fallbackSteps = detectToolsWithRegex(userMessage);

    // Guardrail: if AI fails to return actionable steps for an actionable request,
    // fall back to regex-based routing instead of silently downgrading to chat.
    const hasAIFoundSteps = Array.isArray(routingPlan.execution_plan?.steps) && routingPlan.execution_plan.steps.length > 0;
    if (!routingPlan.is_off_topic && fallbackSteps.length > 0 && (!routingPlan.requires_tools || !hasAIFoundSteps)) {
      const isSequentialFallback = fallbackSteps.some(step => Array.isArray(step.depends_on) && step.depends_on.length > 0);
      routingPlan.requires_tools = true;
      routingPlan.execution_plan = {
        type: isSequentialFallback ? 'sequential' : 'parallel',
        steps: fallbackSteps
      };
      routingPlan.missing_info = routingPlan.missing_info || [];
      routingPlan.analysis = routingPlan.analysis
        ? `${routingPlan.analysis} [auto-corrected with fallback routing]`
        : 'Auto-corrected with fallback routing';
      console.log('[Tool Router] AI returned non-actionable plan; applied regex fallback routing');
    }

    // POST-PROCESS: Enforce get_balance when a calculate step references balance variables
    // This prevents the AI from skipping get_balance and leaving eth_balance unresolved.
    const steps = routingPlan.execution_plan?.steps || [];
    const calcStep = steps.find(s => s.tool === 'calculate');
    if (calcStep) {
      const calcBlob = JSON.stringify(calcStep.parameters || '').toLowerCase();
      const needsBalance = /eth_balance|wallet_balance|my_balance\b/.test(calcBlob);
      const hasGetBalance = steps.some(s => s.tool === 'get_balance');
      if (needsBalance && !hasGetBalance) {
        // Try to extract wallet address from conversation history
        const historyStr = (conversationHistory || []).map(m => m.content || '').join(' ');
        const addrMatch = historyStr.match(/0x[a-fA-F0-9]{40}/);
        const walletAddress = addrMatch ? addrMatch[0] : null;
        const balanceStep = {
          tool: 'get_balance',
          reason: 'Wallet balance is required for this calculation',
          parameters: { address: walletAddress },
          depends_on: []
        };
        steps.unshift(balanceStep);
        routingPlan.execution_plan.steps = steps;
        routingPlan.execution_plan.type = 'sequential';
        console.log('[Tool Router] Auto-injected get_balance step — eth_balance needed for calculate');
      }
    }

    // POST-PROCESS: enforce sequential ordering for transfer -> tx_status -> send_email chains.
    const hasTransfer = steps.some(s => s.tool === 'transfer');
    const hasTxStatus = steps.some(s => s.tool === 'tx_status' || s.tool === 'lookup_transaction');
    const hasSendEmail = steps.some(s => s.tool === 'send_email');
    if (hasTransfer && (hasTxStatus || hasSendEmail)) {
      const order = ['transfer', 'tx_status', 'lookup_transaction', 'send_email'];
      const ordered = [
        ...order.flatMap(name => steps.filter(s => s.tool === name)),
        ...steps.filter(s => !order.includes(s.tool))
      ];

      routingPlan.execution_plan.steps = ordered;
      routingPlan.execution_plan.type = 'sequential';
      console.log('[Tool Router] Enforced sequential order for transfer/status/email flow');
    }

    console.log('[Tool Router] AI Routing Plan:', JSON.stringify(routingPlan, null, 2));
    
    return routingPlan;
  } catch (error) {
    console.error('[Tool Router] Error:', error.message);
    const fallbackSteps = detectToolsWithRegex(userMessage);
    const isSequential = fallbackSteps.some(step => Array.isArray(step.depends_on) && step.depends_on.length > 0);
    const hasFallbackSteps = fallbackSteps.length > 0;
    
    // Fallback to simple routing
    return {
      analysis: 'Fallback routing due to AI error',
      is_off_topic: false,
      requires_tools: hasFallbackSteps,
      execution_plan: {
        type: isSequential ? 'sequential' : 'parallel',
        steps: fallbackSteps
      },
      missing_info: [],
      complexity: 'simple'
    };
  }
}

/**
 * Fallback: Simple regex-based tool detection (old method)
 * @param {string} message - User message
 * @returns {Array} List of tool steps
 */
function detectToolsWithRegex(message) {
  const tools = [];
  const hasEmailIntent = /\b(email|send.*email|mail|notify|notification)\b/i.test(message);
  const hasTransferIntent =
    /\b(transfer|pay|move)\b/i.test(message) ||
    (/\bsend\b/i.test(message) && (/0x[a-fA-F0-9]{40}/.test(message) || /\b\d+(?:\.\d+)?\b/.test(message) || /\beth\b/i.test(message)));
  const hasStatusIntent = /\b(status|confirm|confirmation|tx\s*status|transaction\s*status|check\s*status)\b/i.test(message);
  
  if (/\b(price|fetch.*price|get.*price|check.*price|what.*price|how.*much|cost)\b/i.test(message)) {
    tools.push({ 
      tool: 'fetch_price', 
      reason: 'User mentioned price',
      parameters: {},
      depends_on: [] 
    });
  }
  
  if (/\b(balance|wallet|check.*balance|get.*balance|how.*much.*have|account)\b/i.test(message)) {
    tools.push({ 
      tool: 'get_balance', 
      reason: 'User mentioned balance or wallet',
      parameters: {},
      depends_on: [] 
    });
  }

  if (/\b(flow setup|flow overview|flow config|flow configuration|flow faucet|flowscan|sponsored gas|flow network)\b/i.test(message)) {
    tools.push({
      tool: 'get_flow_network_overview',
      reason: 'User asked for Flow network setup or onboarding details',
      parameters: {},
      depends_on: []
    });
  }

  if (/\b(flow wallet ready|wallet readiness|is my flow wallet ready|funded on flow|need flow faucet|flow wallet)\b/i.test(message)) {
    tools.push({
      tool: 'get_flow_wallet_readiness',
      reason: 'User asked whether their wallet is ready for Flow',
      parameters: {},
      depends_on: []
    });
  }
  
  if (hasTransferIntent && !(hasEmailIntent && !/\b(transfer|pay|move)\b/i.test(message))) {
    tools.push({ 
      tool: 'transfer', 
      reason: 'User wants to transfer',
      parameters: {},
      depends_on: [] 
    });
  }

  if (hasStatusIntent) {
    const hasTransferStep = tools.some(t => t.tool === 'transfer');
    tools.push({
      tool: 'tx_status',
      reason: 'User asked to confirm or check transaction status',
      parameters: {},
      depends_on: hasTransferStep ? ['transfer'] : []
    });
  }
  
  if (/\b(deploy.*erc20|deploy.*token|create.*token|new.*token)\b/i.test(message)) {
    tools.push({ 
      tool: 'deploy_erc20', 
      reason: 'User wants to deploy ERC20',
      parameters: {},
      depends_on: [] 
    });
  }
  
  if (/\b(deploy.*erc721|deploy.*nft|create.*nft|new.*nft|nft.*collection)\b/i.test(message)) {
    tools.push({ 
      tool: 'deploy_erc721', 
      reason: 'User wants to deploy NFT',
      parameters: {},
      depends_on: [] 
    });
  }

  if (/\b(payroll|salary|contributor payout|employee payout|biweekly pay|monthly pay)\b/i.test(message)) {
    tools.push({
      tool: 'create_payroll_plan',
      reason: 'User wants a recurring payroll-style Flow payout',
      parameters: {},
      depends_on: []
    });
  }

  if (/\b(grant payout|grant plan|stipend|ecosystem grant|community grant)\b/i.test(message)) {
    tools.push({
      tool: 'create_grant_payout',
      reason: 'User wants a recurring grant payout on Flow',
      parameters: {},
      depends_on: []
    });
  }

  if (hasEmailIntent) {
    const dependencies = [];
    if (tools.some(t => t.tool === 'transfer')) dependencies.push('transfer');
    if (tools.some(t => t.tool === 'tx_status')) dependencies.push('tx_status');
    tools.push({ 
      tool: 'send_email', 
      reason: 'User wants to send an email',
      parameters: {},
      depends_on: dependencies 
    });
  }
  
  return tools;
}

/**
 * Convert routing plan to format expected by agent backend
 * @param {Object} routingPlan - The routing plan from intelligentToolRouting
 * @returns {Array} Tools array for agent backend
 */
function convertToAgentFormat(routingPlan) {
  if (!routingPlan.requires_tools || !routingPlan.execution_plan) {
    return [];
  }

  const { steps, type } = routingPlan.execution_plan;
  
  return steps.map((step, index) => {
    const nextTool = type === 'sequential' && index < steps.length - 1 
      ? steps[index + 1].tool 
      : null;

    return {
      tool: step.tool,
      next_tool: nextTool,
      parameters: step.parameters || {},
      reason: step.reason
    };
  });
}

module.exports = {
  intelligentToolRouting,
  convertToAgentFormat,
  AVAILABLE_TOOLS
};

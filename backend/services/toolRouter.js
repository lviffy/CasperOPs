/**
 * Tool router for the CasperOPs AI agent.
 *
 * Maps the 22 Casper-native tools (CSPR transfers, CEP-18 / CEP-78 deploys,
 * agent registry, reputation, escrow, market data, utilities) to their
 * underlying handlers. The router can dispatch to:
 *   1. Local handlers (`directToolExecutor.js`) for read-only / CSPR queries.
 *   2. HTTP routes for tools that wrap external services (send_email, etc.).
 *   3. The Casper chain (via `casper-js-sdk`) for state-changing deploys.
 *
 * The router is also where x402 payment is enforced — the middleware
 * (`backend/middleware/x402-verify.js`) reads the
 * `X-Casper-Payment-Deploy-Hash` header before the request reaches here.
 */

const { chatWithAI } = require('./aiService');
const { detectReminderPlan } = require('./reminderIntent');
const { isToolSupportedOnChain, getChainMetadata } = require('../utils/chains');
const { logger } = require('../utils/logger');

const log = logger.child({ component: 'toolRouter' });

/**
 * Casper-native tools exposed by the CasperOPs AI agent.
 * Replaces the legacy EVM (Flow / Arbitrum / Ethereum) toolset.
 */
const AVAILABLE_TOOLS = {
  fetch_price: {
    name: 'fetch_price',
    description: 'Fetches the current price of CSPR (or another supported token) in USD via CSPR.cloud / CoinGecko.',
    parameters: ['token_name (defaults to CSPR)', 'vsCurrency (optional, defaults to USD)'],
    examples: ['What is the price of CSPR?', 'How much is CSPR worth in USD?'],
  },
  get_balance: {
    name: 'get_balance',
    description: 'Gets the native CSPR balance of a wallet on Casper Testnet. "my balance" resolves to the connected wallet.',
    parameters: ['wallet_address (optional for self-balance)'],
    examples: ['Check my CSPR balance', 'How much CSPR do I have?'],
  },
  transfer: {
    name: 'transfer',
    description: 'Transfers native CSPR (or CEP-18 token) to another Casper account. Signed via CSPR.click session on the frontend.',
    parameters: ['toPublicKey (or accountHash)', 'amount', 'tokenAddress (optional)'],
    examples: ['Send 25 CSPR to <public-key>', 'Transfer 100 BOUSD to Alice'],
  },
  batch_transfer: {
    name: 'batch_transfer',
    description: 'Airdrops CSPR to multiple wallet addresses in a single deploy.',
    parameters: ['recipients (array of {publicKey|accountHash, amount})'],
    examples: ['Airdrop 5 CSPR to 5 wallets'],
  },
  deploy_cep18: {
    name: 'deploy_cep18',
    description: 'Deploys a CEP-18 fungible token (ERC-20 equivalent) on Casper Testnet.',
    parameters: ['name', 'symbol', 'decimals', 'totalSupply'],
    examples: ['Deploy a CEP-18 token called BOUSD'],
  },
  deploy_cep78: {
    name: 'deploy_cep78',
    description: 'Deploys a CEP-78 NFT collection (ERC-721 equivalent) on Casper Testnet.',
    parameters: ['name', 'symbol', 'totalTokenSupply'],
    examples: ['Deploy a CEP-78 NFT collection called CasperOPsAvatars'],
  },
  mint_nft: {
    name: 'mint_nft',
    description: 'Mints a new NFT into an existing CEP-78 collection.',
    parameters: ['collectionHash', 'toPublicKey', 'tokenUri'],
    examples: ['Mint an NFT into collection <hash>'],
  },
  get_token_info: {
    name: 'get_token_info',
    description: 'Reads CEP-18 token metadata (name, symbol, decimals, total supply).',
    parameters: ['tokenContractHash'],
    examples: ['Get info about token <hash>'],
  },
  get_token_balance: {
    name: 'get_token_balance',
    description: 'Returns the CEP-18 token balance for a wallet address.',
    parameters: ['tokenContractHash', 'walletAddress'],
    examples: ['How many BOUSD does <public-key> have?'],
  },
  get_nft_info: {
    name: 'get_nft_info',
    description: 'Returns metadata for a CEP-78 NFT or its parent collection.',
    parameters: ['collectionHash', 'tokenId (optional)'],
    examples: ['Show me NFT #5 in <hash>'],
  },
  lookup_deploy: {
    name: 'lookup_deploy',
    description: 'Looks up a Casper deploy by deploy-hash. Returns status, block, cost.',
    parameters: ['deployHash'],
    examples: ['Check the status of deploy <hash>'],
  },
  lookup_block: {
    name: 'lookup_block',
    description: 'Returns information about a Casper block by height (or "latest").',
    parameters: ['blockHeight (or "latest")'],
    examples: ['What is the latest block?'],
  },
  calculate: {
    name: 'calculate',
    description: 'Performs math or unit conversions (e.g. motes ↔ CSPR, USD ↔ CSPR).',
    parameters: ['expression', 'values'],
    examples: ['Convert 2500000000 motes to CSPR'],
  },
  send_email: {
    name: 'send_email',
    description: 'Sends a plain-text or HTML email notification.',
    parameters: ['to', 'subject', 'text (optional)', 'html (optional)', 'cc (optional)', 'bcc (optional)', 'replyTo (optional)'],
    examples: ['Email alice@example.com the deploy receipt'],
  },
  register_agent: {
    name: 'register_agent',
    description: 'Calls on-chain AgentFactory to record a new agent and its owner.',
    parameters: ['agentAddress'],
    examples: ['Register a new agent on Casper'],
  },
  attest_agent: {
    name: 'attest_agent',
    description: 'Calls on-chain Compliance to attest an agent (RWA / KYC status) with a metadata URI.',
    parameters: ['agentAddress', 'verified (bool)', 'metadataUri'],
    examples: ['Mark <public-key> as verified for RWA trading'],
  },
  get_reputation: {
    name: 'get_reputation',
    description: 'Reads on-chain reputation rating + success/failure stats via the Reputation contract.',
    parameters: ['agentAddress'],
    examples: ['What is the reputation of <public-key>?'],
  },
  yield_rebalance: {
    name: 'yield_rebalance',
    description: 'Rebalances positions across supported Casper DeFi protocols.',
    parameters: ['agentAddress', 'strategyId (optional)', 'riskTolerance (low|medium|high)'],
    examples: ['Rebalance my yield vault to low risk'],
  },
  wallet_readiness: {
    name: 'wallet_readiness',
    description: 'Returns whether a Casper wallet is funded and ready, with a faucet link.',
    parameters: ['walletAddress'],
    examples: ['Is my Casper wallet ready?'],
  },
  rwa_valuation: {
    name: 'rwa_valuation',
    description: 'Fetches the certified appraisal and land registry valuation for a property address. Requires x402 payment.',
    parameters: ['propertyAddress'],
    examples: ['Get property valuation for 010101...', 'Appraise the RWA property at 010203...'],
  },
  fractionalize_rwa: {
    name: 'fractionalize_rwa',
    description: 'Fractionalizes a certified RWA (Real World Asset) valuation into a CEP-18 token or CEP-78 fractional NFT collection representing ownership shares. Requires x402 payment.',
    parameters: ['propertyAddress', 'valuationId', 'tokenName', 'tokenSymbol', 'decimals (optional, defaults to 9)', 'fractionsCount (optional, defaults to 10000)'],
    examples: ['Fractionalize the property at 010101... with valuation id val-123 into 1000000 shares', 'Tokenize property 010203... with valuation val-abc into shares named PropShare (PROP) with total supply 100000'],
  },
  attest_performance: {
    name: 'attest_performance',
    description: 'Attests agent execution success or failure directly to the Reputation contract. Requires x402 payment.',
    parameters: ['agentAddress', 'success (bool)'],
    examples: ['Attest performance of agent 010101... as successful', 'Log failure for agent 010203... on reputation contract'],
  },
  schedule_reminder: {
    name: 'schedule_reminder',
    description: 'Schedule a one-time or recurring reminder that posts back into the same chat.',
    parameters: ['taskType (balance|price|reputation)', 'cronExpression', 'walletAddress (for balance)', 'tokenQuery (for price)', 'label (optional)'],
    examples: ['Tell me my CSPR balance after 5 minutes'],
  },
  list_reminders: {
    name: 'list_reminders',
    description: 'List scheduled reminders for the current user / agent.',
    parameters: [],
    examples: ['Show my reminders'],
  },
  cancel_reminder: {
    name: 'cancel_reminder',
    description: 'Cancel a scheduled reminder by id (or matching filters).',
    parameters: ['id (optional)', 'taskType (optional)', 'walletAddress (optional)'],
    examples: ['Cancel reminder abc123'],
  },
  compliance_check: {
    name: 'compliance_check',
    description: 'Checks if an agent or wallet address is compliant on the Compliance contract.',
    parameters: ['agent_id', 'jurisdiction (optional)'],
    examples: ['Is address 0123... compliant?', 'Check compliance status for 0123...'],
  },
  post_message: {
    name: 'post_message',
    description: 'Posts a coordination message to the on-chain MessageBoard contract and broadcasts it via Redis. Requires x402 payment.',
    parameters: ['topic', 'message'],
    examples: ['Post message "risk low" to topic "risk-assessment"', 'Log swarm decision to message board'],
  },
  get_message: {
    name: 'get_message',
    description: 'Gets the latest message for a topic from the on-chain MessageBoard contract.',
    parameters: ['topic'],
    examples: ['Get message for topic "risk-assessment"', 'Read swarm message board for topic "compliance"'],
  },
};

/**
 * Quick regex-based off-topic detection.
 */
const offTopicPatterns = [
  /\b(prime minister|president|politician|government|election|politics)\b/i,
  /\b(weather|temperature|forecast|rain|sunny)\b/i,
  /\b(movie|film|actor|actress|celebrity|entertainment)\b/i,
  /\b(recipe|cooking|food|restaurant|cuisine)\b(?!.*token|contract)/i,
  /\b(sport|football|basketball|soccer|cricket|tennis)\b/i,
  /\b(health|medical|doctor|disease|medicine)\b/i,
  /\bwho is\b.*\b(minister|president|ceo|founder)\b(?!.*(vitalik|satoshi|blockchain|crypto))/i,
];

/**
 * Build the AI routing prompt.
 */
function buildRoutingPrompt({ userMessage, conversationHistory, toolsList, chainMeta }) {
  let conversationContext = '';
  if (conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-10);
    const extractedEntities = [];
    for (const msg of recentMessages) {
      const content = msg.content || '';
      const casperKeys = content.match(/\b0[12][0-9a-fA-F]{64}\b/g);
      if (casperKeys) extractedEntities.push(`Casper public keys mentioned: ${casperKeys.join(', ')}`);
      const hashMatches = content.match(/\b[0-9a-fA-F]{64,}\b/g);
      if (hashMatches) extractedEntities.push(`Hashes mentioned: ${hashMatches.join(', ')}`);
      const csprMatch = content.match(/(\d+\.?\d*)\s*CSPR/i);
      if (csprMatch) extractedEntities.push(`CSPR amount found: ${csprMatch[1]} CSPR`);
      if (content.includes('Balance for')) extractedEntities.push(`Previous result: ${content}`);
      if (content.includes('Current prices:')) extractedEntities.push(`Previous result: ${content}`);
    }
    const entitySummary = extractedEntities.length > 0
      ? `\n\nKEY DATA FROM CONVERSATION (reuse this, do NOT ask user again):\n${[...new Set(extractedEntities)].join('\n')}`
      : '';
    conversationContext = `\n\nRecent conversation (last ${recentMessages.length} messages):\n${recentMessages.map((m) => `${m.role}: ${m.content}`).join('\n')}${entitySummary}`;
  }

  return `You are an intelligent tool routing system for CasperOPs, an autonomous agent platform on the Casper Network. Your PRIMARY job is to create COMPLETE execution plans that resolve the user's request in a single pass, WITHOUT asking the user for information that your tools can fetch.

## Your Responsibilities
1. Determine if the request is blockchain / Casper-related.
2. Create a COMPLETE multi-step tool execution plan.
3. Auto-resolve dependencies by chaining tools — NEVER ask the user for data a tool can provide.
4. Only put truly user-dependent info in missing_info (signing keys, unknown destination public keys, ambiguous token names).

## CRITICAL RULE — RESOLVE, DON'T ASK
If the user's question requires data a tool can fetch, ADD THAT TOOL TO THE PLAN.
- Need a price? → Add fetch_price step.
- Need a balance? → Add get_balance step.
- Need token info? → Add get_token_info step.
"missing_info" is ONLY for things NO tool can resolve.

## Network Context
- Chain: ${chainMeta.name} (${chainMeta.chain})
- Native currency: ${chainMeta.nativeCurrency.symbol} (decimals ${chainMeta.nativeCurrency.decimals})
- Explorer: ${chainMeta.explorerBaseUrl}
- Faucet: ${chainMeta.faucetUrl}

## Available Tools
${toolsList}

## User Request
"${userMessage}"${conversationContext}

Respond ONLY with JSON of the form:
{
  "analysis": "...",
  "is_off_topic": true/false,
  "requires_tools": true/false,
  "extracted_context": { "wallet_address": "...", "cspr_balance": "...", "referenced_tokens": [] },
  "execution_plan": {
    "type": "sequential" or "parallel",
    "steps": [ { "tool": "tool_name", "reason": "...", "parameters": { ... }, "depends_on": [] } ]
  },
  "missing_info": ["..."],
  "complexity": "simple" | "moderate" | "complex"
}

## Common Multi-Step Patterns
- "How many [TOKEN] can I buy with X CSPR / my balance": get_balance → fetch_price (CSPR) → fetch_price (target) → calculate.
- "What is my balance worth in USD": get_balance → fetch_price (cspr) → calculate.
- "Send $X worth of CSPR to <public-key>": fetch_price (cspr) → calculate → transfer.

## Casper Key Conventions
- Public keys are 66 hex chars prefixed with "01" (Ed25519) or "02" (Secp256K1).
- Account hashes are 64 hex chars prefixed with "account-hash-".
- Deploy hashes are 64 hex chars (no prefix).`;
}

/**
 * Use AI to intelligently determine which tools to call and in what order.
 */
async function intelligentToolRouting(userMessage, conversationHistory = [], routingContext = {}) {
  const reminderPlan = detectReminderPlan(userMessage, conversationHistory);
  if (reminderPlan) return reminderPlan;

  const isOffTopic = offTopicPatterns.some((p) => p.test(userMessage));
  if (isOffTopic) {
    return {
      analysis: 'User query is not related to blockchain operations',
      is_off_topic: true,
      requires_tools: false,
      execution_plan: { type: 'none', steps: [] },
      missing_info: [],
      complexity: 'simple',
    };
  }

  const toolsList = Object.values(AVAILABLE_TOOLS)
    .map((tool) => `- ${tool.name}: ${tool.description}\n  Parameters: ${tool.parameters.join(', ')}\n  Examples: ${tool.examples.join('; ')}`)
    .join('\n\n');

  const chainMeta = getChainMetadata();
  const prompt = buildRoutingPrompt({ userMessage, conversationHistory, toolsList, chainMeta });

  try {
    const messages = [
      { role: 'system', content: 'You are a JSON-only tool routing expert. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ];
    const response = await chatWithAI(messages, 'moonshotai/kimi-k2-instruct-0905', {
      temperature: 0.2,
      maxTokens: 2000,
    });

    let jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI response did not contain valid JSON');

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const routingPlan = JSON.parse(jsonStr.trim());

    const fallbackSteps = detectToolsWithRegex(userMessage);
    const hasAIFoundSteps = Array.isArray(routingPlan.execution_plan?.steps) && routingPlan.execution_plan.steps.length > 0;
    if (!routingPlan.is_off_topic && fallbackSteps.length > 0 && (!routingPlan.requires_tools || !hasAIFoundSteps)) {
      const isSequentialFallback = fallbackSteps.some((step) => Array.isArray(step.depends_on) && step.depends_on.length > 0);
      routingPlan.requires_tools = true;
      routingPlan.execution_plan = {
        type: isSequentialFallback ? 'sequential' : 'parallel',
        steps: fallbackSteps,
      };
      routingPlan.missing_info = routingPlan.missing_info || [];
      routingPlan.analysis = routingPlan.analysis
        ? `${routingPlan.analysis} [auto-corrected with fallback routing]`
        : 'Auto-corrected with fallback routing';
      log.warn({ userMessage, reason: 'ai_plan_non_actionable' }, 'AI returned non-actionable plan; applied regex fallback routing');
    }

    const steps = routingPlan.execution_plan?.steps || [];
    const calcStep = steps.find((s) => s.tool === 'calculate');
    if (calcStep) {
      const calcBlob = JSON.stringify(calcStep.parameters || '').toLowerCase();
      const needsBalance = /cspr_balance|wallet_balance|my_balance\b/.test(calcBlob);
      const hasGetBalance = steps.some((s) => s.tool === 'get_balance');
      if (needsBalance && !hasGetBalance) {
        const historyStr = (conversationHistory || []).map((m) => m.content || '').join(' ');
        const casperKeyMatch = historyStr.match(/\b0[12][0-9a-fA-F]{64}\b/);
        const walletAddress = casperKeyMatch ? casperKeyMatch[0] : null;
        steps.unshift({
          tool: 'get_balance',
          reason: 'Wallet balance is required for this calculation',
          parameters: { address: walletAddress },
          depends_on: [],
        });
        routingPlan.execution_plan.steps = steps;
        routingPlan.execution_plan.type = 'sequential';
        log.info({ walletAddress, reason: 'calc_needs_balance' }, 'Auto-injected get_balance step — cspr_balance needed for calculate');
      }
    }

    const hasTransfer = steps.some((s) => s.tool === 'transfer');
    const hasDeployLookup = steps.some((s) => s.tool === 'lookup_deploy');
    const hasSendEmail = steps.some((s) => s.tool === 'send_email');
    if (hasTransfer && (hasDeployLookup || hasSendEmail)) {
      const order = ['transfer', 'lookup_deploy', 'send_email'];
      const ordered = [
        ...order.flatMap((name) => steps.filter((s) => s.tool === name)),
        ...steps.filter((s) => !order.includes(s.tool)),
      ];
      routingPlan.execution_plan.steps = ordered;
      routingPlan.execution_plan.type = 'sequential';
      log.info({ stepCount: ordered.length }, 'Enforced sequential order for transfer/status/email flow');
    }

    log.info({
      isOffTopic: routingPlan.is_off_topic,
      requiresTools: routingPlan.requires_tools,
      stepCount: steps.length,
      complexity: routingPlan.complexity,
      routingType: routingPlan.execution_plan?.type,
    }, 'AI routing plan resolved');
    return routingPlan;
  } catch (error) {
    log.error({ err: error?.message, stack: error?.stack, userMessage }, 'AI routing failed; using regex fallback');
    const fallbackSteps = detectToolsWithRegex(userMessage);
    const isSequential = fallbackSteps.some((step) => Array.isArray(step.depends_on) && step.depends_on.length > 0);
    return {
      analysis: 'Fallback routing due to AI error',
      is_off_topic: false,
      requires_tools: fallbackSteps.length > 0,
      execution_plan: {
        type: isSequential ? 'sequential' : 'parallel',
        steps: fallbackSteps,
      },
      missing_info: [],
      complexity: 'simple',
    };
  }
}

/**
 * Fallback regex-based tool detection (Casper-only).
 */
function detectToolsWithRegex(message) {
  const tools = [];
  const hasEmailIntent = /\b(email|send.*email|mail|notify|notification)\b/i.test(message);
  const casperKeyRegex = /\b0[12][0-9a-fA-F]{64}\b/;
  const hasCsprKeyHint = casperKeyRegex.test(message) || /\b\d+(?:\.\d+)?\s*cspr\b/i.test(message);
  const hasTransferIntent =
    /\b(transfer|pay|move|send)\b/i.test(message) ||
    (/\bsend\b/i.test(message) && (casperKeyRegex.test(message) || /\b\d+(?:\.\d+)?\b/.test(message) || /\bcspr\b/i.test(message)));
  const hasTransferVerb = /\b(transfer|pay|move)\b/i.test(message);
  const hasStatusIntent = /\b(status|confirm|confirmation|deploy\s*status|check\s*status)\b/i.test(message);

  if (/\b(price|fetch.*price|get.*price|check.*price|what.*price|how.*much|cost)\b/i.test(message)) {
    tools.push({ tool: 'fetch_price', reason: 'User mentioned price', parameters: {}, depends_on: [] });
  }
  if (/\b(balance|wallet|check.*balance|get.*balance|how.*much.*have)\b/i.test(message)) {
    tools.push({ tool: 'get_balance', reason: 'User mentioned balance or wallet', parameters: {}, depends_on: [] });
  }
  if (hasTransferIntent && (!hasEmailIntent || hasTransferVerb || hasCsprKeyHint)) {
    tools.push({ tool: 'transfer', reason: 'User wants to transfer CSPR', parameters: {}, depends_on: [] });
  }
  if (hasStatusIntent) {
    const hasTransferStep = tools.some((t) => t.tool === 'transfer');
    tools.push({
      tool: 'lookup_deploy',
      reason: 'User asked to confirm or check deploy status',
      parameters: {},
      depends_on: hasTransferStep ? ['transfer'] : [],
    });
  }
  if (/\b(deploy.*cep18|deploy.*token|create.*token|new.*token|launch.*token)\b/i.test(message)) {
    tools.push({ tool: 'deploy_cep18', reason: 'User wants to deploy a CEP-18 token', parameters: {}, depends_on: [] });
  }
  if (/\b(deploy.*cep78|deploy.*nft|create.*nft|new.*nft|nft.*collection)\b/i.test(message)) {
    tools.push({ tool: 'deploy_cep78', reason: 'User wants to deploy a CEP-78 NFT collection', parameters: {}, depends_on: [] });
  }
  if (/\b(mint.*nft|mint.*token|create.*nft)\b/i.test(message)) {
    tools.push({ tool: 'mint_nft', reason: 'User wants to mint an NFT', parameters: {}, depends_on: [] });
  }
  if (/\b(attest|compliance|verify|kyc)\b/i.test(message)) {
    if (/\b(check|status|is|are|query)\b/i.test(message) || /\b(compliant|check_compliance)\b/i.test(message)) {
      tools.push({ tool: 'compliance_check', reason: 'User wants to check compliance status', parameters: {}, depends_on: [] });
    } else {
      tools.push({ tool: 'attest_agent', reason: 'User wants to attest an agent', parameters: {}, depends_on: [] });
    }
  }
  if (/\b(reputation|rating|trust)\b/i.test(message)) {
    tools.push({ tool: 'get_reputation', reason: 'User mentioned reputation', parameters: {}, depends_on: [] });
  }
  if (/\b(rebalance|yield|stake|defi)\b/i.test(message)) {
    tools.push({ tool: 'yield_rebalance', reason: 'User mentioned yield / rebalance', parameters: {}, depends_on: [] });
  }
  if (/\b(register.*agent|new.*agent|create.*agent)\b/i.test(message)) {
    tools.push({ tool: 'register_agent', reason: 'User wants to register an agent', parameters: {}, depends_on: [] });
  }
  if (/\b(appraise|valuation|rwa|property.*val)\b/i.test(message)) {
    tools.push({ tool: 'rwa_valuation', reason: 'User mentioned property valuation / appraisal', parameters: {}, depends_on: [] });
  }
  if (/\b(fractionalize|tokenize|split.*shares|fractional.*shares|fractionalize.*rwa)\b/i.test(message)) {
    tools.push({ tool: 'fractionalize_rwa', reason: 'User mentioned fractionalizing / tokenizing an RWA', parameters: {}, depends_on: [] });
  }
  if (/\b(attest.*perf|log.*success|log.*failure|slash.*reput|reputation.*attest)\b/i.test(message)) {
    tools.push({ tool: 'attest_performance', reason: 'User mentioned attesting agent performance or reputation', parameters: {}, depends_on: [] });
  }
  if (/\b(post.*message|write.*message|send.*message|log.*message|board.*post)\b/i.test(message)) {
    tools.push({ tool: 'post_message', reason: 'User wants to post a message', parameters: {}, depends_on: [] });
  }
  if (/\b(get.*message|read.*message|fetch.*message|board.*get)\b/i.test(message)) {
    tools.push({ tool: 'get_message', reason: 'User wants to get a message', parameters: {}, depends_on: [] });
  }
  if (hasEmailIntent) {
    const dependencies = [];
    if (tools.some((t) => t.tool === 'transfer')) dependencies.push('transfer');
    if (tools.some((t) => t.tool === 'lookup_deploy')) dependencies.push('lookup_deploy');
    tools.push({ tool: 'send_email', reason: 'User wants to send an email', parameters: {}, depends_on: dependencies });
  }
  return tools;
}

/**
 * Convert routing plan to format expected by the agent backend.
 */
function convertToAgentFormat(routingPlan) {
  if (!routingPlan.requires_tools || !routingPlan.execution_plan) return [];
  const { steps, type } = routingPlan.execution_plan;
  return steps.map((step, index) => {
    const nextTool = type === 'sequential' && index < steps.length - 1
      ? steps[index + 1].tool
      : null;
    return {
      tool: step.tool,
      next_tool: nextTool,
      parameters: step.parameters || {},
      reason: step.reason,
    };
  });
}

module.exports = {
  AVAILABLE_TOOLS,
  intelligentToolRouting,
  convertToAgentFormat,
  detectToolsWithRegex,
};

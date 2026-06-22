const supabase = require('../config/supabase');
const { buildContext, truncateMessage } = require('../utils/memory');
const { chatWithAI } = require('../services/aiService');
const { intelligentToolRouting, convertToAgentFormat } = require('../services/toolRouter');
const { executeToolsDirectly: executeToolsDirectlyService, formatToolResponse } = require('../services/directToolExecutor');
const {
  archiveToolExecutionLogs,
  formatExecutionAuditForChat,
  sanitizeToolResultsForResponse
} = require('../services/toolAuditLogService');
const { fireEvent } = require('../services/webhookService');
const { BlockOpsAgentRuntime } = require('../services/agentRuntime');
const { DEFAULT_CHAIN, getChainConfig } = require('../config/constants');
const { buildUnsupportedToolError, isToolSupportedOnChain, normalizeChainId } = require('../utils/chains');

const IN_MEMORY_MESSAGE_LIMIT = 30;
const DEFAULT_AUDIT_WAIT_MS = 8000;
const inMemoryConversations = new Map();
const UUID_V4_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value) {
  return typeof value === 'string' && UUID_V4_LIKE_REGEX.test(value);
}

function createTempConversationId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLatestInMemoryConversationId(userId, agentId) {
  let latestConversation = null;

  for (const conversation of inMemoryConversations.values()) {
    if (conversation.userId !== userId || conversation.agentId !== agentId) {
      continue;
    }

    if (!latestConversation || new Date(conversation.updatedAt) > new Date(latestConversation.updatedAt)) {
      latestConversation = conversation;
    }
  }

  return latestConversation?.id || null;
}

function getOrCreateInMemoryConversation({ conversationId, userId, agentId, title }) {
  let convId = conversationId;
  let isNewConversation = false;

  if (!convId) {
    convId = getLatestInMemoryConversationId(userId, agentId) || createTempConversationId();
    isNewConversation = !inMemoryConversations.has(convId);
  } else {
    isNewConversation = !inMemoryConversations.has(convId);
  }

  if (!inMemoryConversations.has(convId)) {
    inMemoryConversations.set(convId, {
      id: convId,
      userId,
      agentId,
      title: title || 'Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    });
  }

  const conversation = inMemoryConversations.get(convId);
  conversation.updatedAt = new Date().toISOString();
  if (!conversation.title && title) {
    conversation.title = title;
  }

  return { conversation, convId, isNewConversation };
}

function addInMemoryMessage(conversationId, role, content, toolCalls = null) {
  const conversation = inMemoryConversations.get(conversationId);
  if (!conversation) {
    return;
  }

  const message = {
    id: `mem-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    created_at: new Date().toISOString()
  };

  if (toolCalls) {
    message.tool_calls = toolCalls;
  }

  conversation.messages.push(message);
  if (conversation.messages.length > IN_MEMORY_MESSAGE_LIMIT) {
    conversation.messages = conversation.messages.slice(-IN_MEMORY_MESSAGE_LIMIT);
  }
  conversation.updatedAt = new Date().toISOString();
}

function getInMemoryMessages(conversationId) {
  const conversation = inMemoryConversations.get(conversationId);
  return conversation?.messages || [];
}

function hasInMemoryConversation(conversationId) {
  return inMemoryConversations.has(conversationId);
}

function appendAssistantMessageToConversation(conversationId, content, toolCalls = null) {
  addInMemoryMessage(conversationId, 'assistant', content, toolCalls);
}

function getAuditWaitMs() {
  const parsed = parseInt(process.env.FILECOIN_AUDIT_WAIT_MS || `${DEFAULT_AUDIT_WAIT_MS}`, 10);
  if (Number.isNaN(parsed) || parsed < 500) {
    return DEFAULT_AUDIT_WAIT_MS;
  }

  return Math.min(parsed, 60000);
}

function extractExplicitAddressFromMessage(message = '') {
  const match = String(message).match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

function extractExplicitChainFromMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return null;

  if (/\b(arbitrum sepolia|arb sepolia|arbitrum)\b/.test(normalized)) {
    return 'arbitrum-sepolia';
  }

  if (/\b(flow evm testnet|flow testnet|flow evm|flow)\b/.test(normalized)) {
    return 'flow-testnet';
  }

  return null;
}

function isSelfWalletQuery(message = '') {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;

  return (
    /\bmy\b/.test(normalized) ||
    /\bme\b/.test(normalized) ||
    /\bmine\b/.test(normalized) ||
    /\bmy wallet\b/.test(normalized) ||
    /\bwhat is my balance\b/.test(normalized) ||
    /\bcheck my balance\b/.test(normalized) ||
    /\bwallet balance\b/.test(normalized)
  );
}

function createPendingExecutionAudit(toolResults) {
  const toolCalls = Array.isArray(toolResults?.tool_calls) ? toolResults.tool_calls : [];
  const results = Array.isArray(toolResults?.results) ? toolResults.results : [];
  const now = new Date().toISOString();

  const entries = results.map((result, index) => {
    const toolCall = toolCalls[index] || {};
    const payload = result?.result || {};
    const txHash =
      payload.transactionHash ||
      payload.txHash ||
      payload.tx_hash ||
      payload.hash ||
      payload.receipt?.transactionHash ||
      null;
    const amount = payload.amount || toolCall?.parameters?.amount || null;

    return {
      id: `pending-${Date.now()}-${index + 1}`,
      tool: toolCall.tool || result?.tool || `tool_step_${index + 1}`,
      success: Boolean(result?.success),
      chain: payload.chain || payload.network || null,
      timestamp: now,
      txHash,
      amount,
      storageStatus: 'pending',
      filecoinCid: null,
      filecoinUri: null,
      prepareTxHash: null,
      storageError: 'Filecoin archival in progress',
      dbError: null
    };
  });

  return {
    totalCount: entries.length,
    successfulCount: entries.filter((entry) => entry.success).length,
    filecoinStoredCount: 0,
    pending: true,
    entries
  };
}

/**
 * Main chat endpoint - handles conversation and AI response
 * POST /api/chat
 */
async function chat(req, res) {
  try {
    const {
      agentId,
      userId,
      message,
      conversationId,
      systemPrompt,
      walletAddress,
      walletType,
      pkpPublicKey,
      pkpTokenId,
      privateKey,
      enabledTools,
      deliveryPlatform,
      telegramChatId,
      defaultEmailTo,
      userEmail,
      chain
    } = req.body;
    const selectedChain = normalizeChainId(chain || DEFAULT_CHAIN);

    // Validation
    if (!agentId || !userId || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: agentId, userId, message' 
      });
    }

    // Fire webhook for inbound message (non-blocking)
    fireEvent(agentId, 'agent.message', { userId, message, walletAddress: walletAddress || null, chain: selectedChain });
    if (walletAddress) {
      console.log('[Chat] User wallet address:', walletAddress);
    } else {
      console.log('[Chat] No wallet address provided');
    }

    // Truncate message if too long
    const truncatedMessage = truncateMessage(message);
    const explicitChainInMessage = extractExplicitChainFromMessage(truncatedMessage);
    const requestedChain = normalizeChainId(explicitChainInMessage || selectedChain);
    const chainConfig = getChainConfig(requestedChain);

    // Get or create conversation (with Supabase if available, otherwise in-memory)
    let convId = conversationId;
    let isNewConversation = false;
    let messages = [];
    const idsAreSupabaseCompatible =
      isUuidLike(agentId) &&
      isUuidLike(userId) &&
      (!conversationId || isUuidLike(conversationId));

    let useSupabase = !!supabase && idsAreSupabaseCompatible; // Track whether we're using Supabase for this request
    const conversationTitle = truncatedMessage.slice(0, 100);

    if (!!supabase && !idsAreSupabaseCompatible) {
      console.log('[Chat] Non-UUID ids detected (likely Telegram/generic mode), using memory-only conversation mode');
    }

    if (useSupabase) {
      // Use Supabase for persistent conversation memory
      if (!convId) {
        // Create new conversation
        const { data, error } = await supabase
          .from('conversations')
          .insert({ 
            agent_id: agentId, 
            user_id: userId, 
            title: conversationTitle // Use first 100 chars as title
          })
          .select()
          .single();
        
        if (error) {
          console.error('Error creating conversation:', error);
          // If it's a foreign key error (agent doesn't exist), fall back to in-memory mode
          if (error.code === '23503' || error.code === '22P02') {
            console.log('[Chat] Agent not in database or invalid ID, falling back to memory-only mode');
            const memoryConversation = getOrCreateInMemoryConversation({
              conversationId: convId,
              userId,
              agentId,
              title: conversationTitle
            });
            convId = memoryConversation.convId;
            isNewConversation = memoryConversation.isNewConversation;
            addInMemoryMessage(convId, 'user', truncatedMessage);
            messages = getInMemoryMessages(convId);
            useSupabase = false;
          } else {
            throw new Error('Failed to create conversation');
          }
        } else {
          convId = data.id;
          isNewConversation = true;
        }
      }

      // Save user message (only if we're still using Supabase)
      if (useSupabase) {
        const { error: msgError } = await supabase
          .from('conversation_messages')
          .insert({ 
            conversation_id: convId, 
            role: 'user', 
            content: truncatedMessage 
          });

        if (msgError) {
          console.error('Error saving user message:', msgError);
          console.log('[Chat] Switching to in-memory mode after save error');
          useSupabase = false;

          const memoryConversation = getOrCreateInMemoryConversation({
            conversationId: convId,
            userId,
            agentId,
            title: conversationTitle
          });
          convId = memoryConversation.convId;
          isNewConversation = memoryConversation.isNewConversation;
          addInMemoryMessage(convId, 'user', truncatedMessage);
          messages = getInMemoryMessages(convId);
        }
      }

      // Get conversation history (last 30 messages due to auto-cleanup)
      if (useSupabase) {
        const { data: messageData, error: fetchError } = await supabase
          .from('conversation_messages')
          .select('role, content, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true });

        if (fetchError) {
          console.error('Error fetching messages:', fetchError);
          console.log('[Chat] Switching to in-memory mode after fetch error');
          useSupabase = false;

          const memoryConversation = getOrCreateInMemoryConversation({
            conversationId: convId,
            userId,
            agentId,
            title: conversationTitle
          });
          convId = memoryConversation.convId;
          isNewConversation = memoryConversation.isNewConversation;
          addInMemoryMessage(convId, 'user', truncatedMessage);
          messages = getInMemoryMessages(convId);
        } else {
          messages = messageData;
        }
      }
    } else {
      // In-memory mode (no persistence) - Supabase not configured
      console.log('[Chat] Running in memory-only mode (Supabase not configured)');
      const memoryConversation = getOrCreateInMemoryConversation({
        conversationId: convId,
        userId,
        agentId,
        title: conversationTitle
      });
      convId = memoryConversation.convId;
      isNewConversation = memoryConversation.isNewConversation;
      addInMemoryMessage(convId, 'user', truncatedMessage);
      messages = getInMemoryMessages(convId);
    }

    // Check if the message requires tools using intelligent AI routing
    console.log('[Chat] Analyzing message for tool requirements...');
    
    const routingPlan = await intelligentToolRouting(truncatedMessage, messages, {
      chain: requestedChain,
      chainId: chainConfig.chainId,
      networkName: chainConfig.name
    });

    if (routingPlan.execution_plan?.steps?.length) {
      const explicitAddressInMessage = extractExplicitAddressFromMessage(truncatedMessage);
      const shouldPreferRequestWallet = Boolean(walletAddress) && !explicitAddressInMessage && isSelfWalletQuery(truncatedMessage);

      routingPlan.execution_plan.steps = routingPlan.execution_plan.steps.map((step) => {
        if (!step || !step.tool) return step;

        const nextParameters = {
          ...(step.parameters || {})
        };

        nextParameters.chain = requestedChain;

        if (shouldPreferRequestWallet) {
          if (step.tool === 'get_balance' || step.tool === 'get_portfolio') {
            nextParameters.address = walletAddress;
            nextParameters.wallet_address = walletAddress;
          }

          if (step.tool === 'schedule_reminder') {
            const taskType = String(nextParameters.taskType || nextParameters.task_type || '').toLowerCase();
            if (taskType === 'balance' || taskType === 'portfolio') {
              nextParameters.walletAddress = walletAddress;
              nextParameters.wallet_address = walletAddress;
            }
          }
        }

        return {
          ...step,
          parameters: nextParameters
        };
      });
    }

    routingPlan.requested_chain = requestedChain;
    routingPlan.requested_network = chainConfig.name;

    const TOOL_ALIASES = {
      tx_status: 'lookup_transaction',
      wallet_history: 'wallet_history'
    };
    const normalizeToolName = (toolName) => TOOL_ALIASES[toolName] || toolName;
    const isReminderToolAllowed = (step, allowedTools) => {
      if (!step) return false;
      if (allowedTools.includes(step.tool)) return true;

      if (step.tool === 'schedule_reminder') {
        const taskType = step.parameters?.taskType;
        if (taskType === 'balance') return allowedTools.includes('get_balance');
        if (taskType === 'price') return allowedTools.includes('fetch_price');
        if (taskType === 'portfolio') {
          return allowedTools.includes('get_portfolio') || allowedTools.includes('get_balance') || allowedTools.includes('fetch_price');
        }
      }

      if (step.tool === 'list_reminders' || step.tool === 'cancel_reminder') {
        return ['schedule_reminder', 'get_balance', 'get_portfolio', 'fetch_price'].some((toolName) => allowedTools.includes(toolName));
      }

      return false;
    };
    let blockedByToolPermissions = false;
    let requestedTools = [];
    
    // Filter routing plan steps to only allowed tools (if agent has restrictions)
    if (enabledTools && Array.isArray(enabledTools) && enabledTools.length > 0) {
      const normalizedAllowedTools = enabledTools.map(normalizeToolName);
      if (routingPlan.execution_plan?.steps) {
        const originalSteps = [...routingPlan.execution_plan.steps];
        routingPlan.execution_plan.steps = routingPlan.execution_plan.steps.filter(
          step => isReminderToolAllowed(step, normalizedAllowedTools)
        );
        requestedTools = [...new Set(originalSteps.map(step => step.tool))];
        if (originalSteps.length > 0 && routingPlan.execution_plan.steps.length === 0) {
          blockedByToolPermissions = true;
        }
        if (routingPlan.execution_plan.steps.length === 0) {
          routingPlan.requires_tools = false;
        }
      }
      console.log('[Chat] Tool filter applied — allowed:', enabledTools);
    }

    console.log('[Chat] Routing analysis:', {
      isOffTopic: routingPlan.is_off_topic,
      requiresTools: routingPlan.requires_tools,
      complexity: routingPlan.complexity,
      chain: requestedChain,
      executionType: routingPlan.execution_plan?.type,
      toolCount: routingPlan.execution_plan?.steps?.length || 0,
      blockedByToolPermissions
    });

    const unsupportedStep = routingPlan.execution_plan?.steps?.find((step) => {
      const stepChain = normalizeChainId(step?.parameters?.chain || requestedChain);
      return !isToolSupportedOnChain(step.tool, stepChain);
    });
    if (unsupportedStep) {
      const unsupportedChain = normalizeChainId(unsupportedStep?.parameters?.chain || requestedChain);
      const unsupportedMessage = buildUnsupportedToolError(unsupportedStep.tool, unsupportedChain);

      if (useSupabase) {
        await supabase
          .from('conversation_messages')
          .insert({
            conversation_id: convId,
            role: 'assistant',
            content: unsupportedMessage
          });
      } else {
        addInMemoryMessage(convId, 'assistant', unsupportedMessage);
      }

      return res.json({
        conversationId: convId,
        message: unsupportedMessage,
        isNewConversation,
        messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
        hasTools: false,
        unsupportedTool: unsupportedStep.tool,
        chain: unsupportedChain
      });
    }

    if (blockedByToolPermissions) {
      const permissionMessage = `I identified a blockchain action request, but this agent is not allowed to run the required tools: ${requestedTools.join(', ')}. No transaction was sent and no email was sent. Please enable those tools for this agent and retry.`;

      if (useSupabase) {
        await supabase
          .from('conversation_messages')
          .insert({
            conversation_id: convId,
            role: 'assistant',
            content: permissionMessage
          });
      } else {
        addInMemoryMessage(convId, 'assistant', permissionMessage);
      }

      return res.json({
        conversationId: convId,
        message: permissionMessage,
        isNewConversation,
        messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
        hasTools: false,
        toolPermissionBlocked: true
      });
    }
    
    // Guard rail: Reject off-topic questions
    if (routingPlan.is_off_topic) {
      const rejectionMessage = "I'm a blockchain operations assistant and can only help with blockchain-related tasks such as checking cryptocurrency prices, wallet balances, deploying tokens/NFTs, and managing transactions. Please ask me something related to blockchain or crypto operations.";
      
      // Save rejection message
      if (useSupabase) {
        await supabase
          .from('conversation_messages')
          .insert({ 
            conversation_id: convId, 
            role: 'assistant', 
            content: rejectionMessage
          });
      } else {
        addInMemoryMessage(convId, 'assistant', rejectionMessage);
      }

      return res.json({
        conversationId: convId,
        message: rejectionMessage,
        isNewConversation,
        messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
        offTopicRejection: true
      });
    }
    
    let aiResponse;
    let toolResults = null;
    let executionAudit = null;

    if (routingPlan.requires_tools && routingPlan.execution_plan?.steps?.length > 0) {
      // Filter missing_info: remove items that tools in the plan can resolve
      const toolResolvablePatterns = [
        /price/i, /eth.*price/i, /token.*price/i, /current.*price/i,
        /balance/i, /wallet.*balance/i, /eth.*balance/i,
        /token.*info/i, /contract.*info/i,
        /convert.*eth.*usd/i, /usd.*value/i
      ];
      
      const trulyMissingInfo = (routingPlan.missing_info || []).filter(info => {
        // Keep only info that no tool can resolve
        const isToolResolvable = toolResolvablePatterns.some(pattern => pattern.test(info));
        if (isToolResolvable) {
          console.log(`[Chat] Auto-resolving via tools: "${info}"`);
        }
        return !isToolResolvable;
      });
      
      // Also check if "missing" info is actually in conversation context
      const contextStr = `${messages.map(m => m.content).join(' ')} ${walletAddress || ''} ${defaultEmailTo || ''} ${userEmail || ''}`;
      const hasUsablePrivateKey = typeof privateKey === 'string' && privateKey.trim().length > 0;
      const hasTransferStep = routingPlan.execution_plan?.steps?.some(step => step.tool === 'transfer');
      const hasSendEmailStep = routingPlan.execution_plan?.steps?.some(step => step.tool === 'send_email');
      const resolvedEmailTo = defaultEmailTo || userEmail || null;
      const finalMissingInfo = trulyMissingInfo.filter(info => {
        if (hasUsablePrivateKey && /private\s*key|signing\s*key|privatekey/i.test(info)) {
          console.log(`[Chat] Private key already provided, removing from missing: "${info}"`);
          return false;
        }
        // Check if the missing info might already be in conversation context
        if (/address/i.test(info) && /0x[a-fA-F0-9]{40}/.test(contextStr)) {
          console.log(`[Chat] Address found in context, removing from missing: "${info}"`);
          return false;
        }
        if (/balance/i.test(info) && /\d+\.?\d*\s*ETH/i.test(contextStr)) {
          console.log(`[Chat] Balance found in context, removing from missing: "${info}"`);
          return false;
        }
        // Lit/wallet-sign flow: transfer can run in prepare mode with walletAddress
        if (walletAddress && hasTransferStep && /private\s*key|signing\s*key|privatekey/i.test(info)) {
          console.log(`[Chat] Wallet-sign mode active, removing signer-key prompt: "${info}"`);
          return false;
        }
        if (hasSendEmailStep && /subject|body|text|email\s*content|message\s*body/i.test(info)) {
          console.log(`[Chat] Email content can be auto-generated, removing from missing: "${info}"`);
          return false;
        }
        if (hasSendEmailStep && resolvedEmailTo && /(^|\b)(to|recipient|email\s*address)(\b|$)/i.test(info)) {
          console.log(`[Chat] Default email recipient available, removing from missing: "${info}"`);
          return false;
        }
        return true;
      });

      // Only ask for truly missing info that can't be resolved by tools or context
      if (finalMissingInfo.length > 0) {
        const signerTools = new Set([
          'deploy_erc20',
          'deploy_erc721',
          'mint_nft',
          'batch_transfer',
          'batch_mint',
          'swap_tokens',
          'bridge_deposit',
          'bridge_withdraw',
          'schedule_transfer'
        ]);
        const hasSignerKeyMissing = finalMissingInfo.some(info => /private\s*key|signing\s*key|privatekey/i.test(info));
        const signerSteps = (routingPlan.execution_plan?.steps || []).filter(step => signerTools.has(step.tool));

        if (!hasUsablePrivateKey && walletAddress && hasSignerKeyMissing && signerSteps.length > 0) {
          const signerToolList = [...new Set(signerSteps.map(step => step.tool))].join(', ');
          const signerMessage = `This request requires transaction signing for tool(s): ${signerToolList}. In direct fallback mode, only transfer supports wallet-sign preparation without a privateKey. Please provide privateKey for these tools, or retry when AI providers recover.`;

          if (useSupabase) {
            await supabase
              .from('conversation_messages')
              .insert({
                conversation_id: convId,
                role: 'assistant',
                content: signerMessage
              });
          } else {
            addInMemoryMessage(convId, 'assistant', signerMessage);
          }

          return res.json({
            conversationId: convId,
            message: signerMessage,
            isNewConversation,
            messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
            needsMoreInfo: true,
            missingInfo: finalMissingInfo,
            signerRequired: true
          });
        }

        const missingInfoMessage = `I need some additional information to help you:\n${finalMissingInfo.map((info, i) => `${i + 1}. ${info}`).join('\n')}`;
        
        // Save AI response asking for more info (if using Supabase)
        if (useSupabase) {
          await supabase
            .from('conversation_messages')
            .insert({ 
              conversation_id: convId, 
              role: 'assistant', 
              content: missingInfoMessage
            });
        } else {
          addInMemoryMessage(convId, 'assistant', missingInfoMessage);
        }

        return res.json({
          conversationId: convId,
          message: missingInfoMessage,
          isNewConversation,
          messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
          needsMoreInfo: true,
          missingInfo: finalMissingInfo
        });
      }

      // Convert routing plan to agent format
      const tools = convertToAgentFormat(routingPlan);
      
      console.log('[Chat] Executing tools:', tools.map(t => `${t.tool}${t.next_tool ? ` → ${t.next_tool}` : ''}`).join(', '));
      
      // Use the new BlockOps Agent Runtime (ERC-8004 PEVD Loop)
      const runtime = new BlockOpsAgentRuntime(agentId, { privateKey });
      let primaryRuntimeResult = null;
      
      try {
        const preferDirectExecution =
          requestedChain !== 'arbitrum-sepolia' ||
          (walletType === 'pkp' &&
            routingPlan.execution_plan?.steps?.some(step => step.tool === 'transfer')) ||
          routingPlan.execution_plan?.steps?.some(step =>
            [
              'schedule_reminder',
              'list_reminders',
              'cancel_reminder',
              'create_savings_plan',
              'schedule_payout',
              'create_payroll_plan',
              'create_grant_payout',
              'get_flow_network_overview',
              'get_flow_wallet_readiness'
            ].includes(step.tool)
          );

        if (preferDirectExecution) {
          throw new Error('Direct execution selected for this request');
        }

        // Build context summary from recent messages for the agent
        const recentMessages = messages.slice(-10);
        
        // Extract key data points from conversation history
        const extractedData = [];
        for (const msg of recentMessages) {
          const content = msg.content || '';
          // Extract wallet addresses
          const addresses = content.match(/0x[a-fA-F0-9]{40}/g);
          if (addresses) extractedData.push(`Wallet address: ${addresses[0]}`);
          // Extract balances
          const balanceMatch = content.match(/Balance.*?:\s*([\d.]+)\s*ETH/i) || content.match(/([\d.]+)\s*ETH/i);
          if (balanceMatch) extractedData.push(`ETH Balance: ${balanceMatch[1]} ETH`);
          // Extract prices
          const priceMatch = content.match(/Current prices?:?\s*(.*)/i);
          if (priceMatch) extractedData.push(`Previous price data: ${priceMatch[1]}`);
        }
        
        const contextSummary = recentMessages
          .map(m => `${m.role}: ${m.content}`)
          .join('\n');
        
        const dataContext = extractedData.length > 0
          ? `\n\nEXTRACTED DATA FROM CONVERSATION (use these values, do NOT ask user):\n${[...new Set(extractedData)].join('\n')}`
          : '';
        
        // Enhance user message with conversation context and routing analysis
        const enhancedMessage = `${routingPlan.analysis}\n\nConversation history:\n${contextSummary}${dataContext}\n\nCurrent user query: ${truncatedMessage}\n\nExecution plan: ${routingPlan.execution_plan.type} with ${routingPlan.execution_plan.steps.length} steps: ${routingPlan.execution_plan.steps.map(s => s.tool).join(' → ')}`;
        
        // Execute through the runtime PEVD loop
        const runtimeResult = await runtime.run(
          truncatedMessage, 
          routingPlan, 
          async () => {
            
        const agentResponse = await fetch('http://localhost:8000/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: tools,
            user_message: enhancedMessage,
            private_key: privateKey || null,
            wallet_address: walletAddress || null,
            chain: requestedChain
          })
        });

            if (!agentResponse.ok) {
              const errorText = await agentResponse.text();
              throw new Error(`Agent backend error: ${agentResponse.status} - ${errorText}`);
            }

            const agentData = await agentResponse.json();
            return agentData;
          }
        );
        primaryRuntimeResult = runtimeResult;

        aiResponse = runtimeResult.agent_response;
        toolResults = {
          tool_calls: runtimeResult.tool_calls || [],
          results: runtimeResult.results || [],
          routing_plan: routingPlan,
          runtime: {
            onChainId: runtimeResult.onChainId,
            decision: runtimeResult.decision,
            verification: runtimeResult.verification,
            agent_log: runtime.exportLogs() // Added standard agent_log.json
          }
        };

        // Treat sentinel rate-limit strings from the agent backend as real errors
        // so the direct-execution fallback can handle them properly
        const RATE_LIMIT_SENTINELS = [
          'rate limit exceeded',
          'all ai providers',
          'maximum iterations reached'
        ];
        if (RATE_LIMIT_SENTINELS.some(s => aiResponse?.toLowerCase().includes(s))) {
          throw new Error(`AI provider rate limited: ${aiResponse}`);
        }
        
        // Clean up AI thinking/reasoning that leaks into responses
        aiResponse = aiResponse
          .replace(/^The user wants to[\s\S]*?(?:\n\n)/m, '')
          .replace(/^I need to use the \w+ tool[\s\S]*?(?:\n\n)/m, '')
          .replace(/^I'?ll compose[\s\S]*?(?:\n\n)/m, '')
          .replace(/^\{\n\s+"to":[\s\S]*?^\}$/gm, '')
          .replace(/^\{"to":\s*"[^"]+",\s*"subject":\s*"[^"]+",\s*"(?:body|text)":\s*"[^"]*"\}$/gm, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        
        // Format JSON data in the response for better display
        aiResponse = aiResponse.replace(/```json\n([\s\S]*?)```/g, (match, json) => {
          try {
            const parsed = JSON.parse(json);
            return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
          } catch {
            return match;
          }
        });
        
        console.log('[Chat] Agent backend response received via runtime PEVD loop');
      } catch (agentError) {
        console.error('[Chat] Agent backend failed:', agentError.message);

        // If the primary runtime already executed tools and updated on-chain state,
        // do not run the full PEVD loop a second time via fallback.
        if (primaryRuntimeResult?.results?.length) {
          console.warn('[Chat] Skipping direct fallback because the primary runtime already produced results.');

          aiResponse = primaryRuntimeResult.agent_response ||
            'The agent completed execution, but the final response formatting failed. Please check the tool results below.';
          toolResults = {
            tool_calls: primaryRuntimeResult.tool_calls || [],
            results: primaryRuntimeResult.results || [],
            routing_plan: routingPlan,
            execution_mode: 'primary_runtime_only',
            runtime: {
              onChainId: primaryRuntimeResult.onChainId,
              decision: primaryRuntimeResult.decision,
              verification: primaryRuntimeResult.verification,
              agent_log: runtime.exportLogs()
            }
          };
        } else {

          // For tool-required requests, always try direct execution fallback.
          // Never degrade to plain chat, which can hallucinate execution status.
          console.log('[Chat] Attempting direct tool execution fallback after agent backend failure...');

          try {
            const runtimeResult = await runtime.run(
              truncatedMessage,
              routingPlan,
              async () => {
                const directExecResult = await executeToolsDirectlyService(
                  routingPlan,
                  truncatedMessage,
                  {
                    walletAddress: walletAddress || null,
                    walletType: walletType || null,
                    pkpPublicKey: pkpPublicKey || null,
                    pkpTokenId: pkpTokenId || null,
                    privateKey: privateKey || null,
                    conversationId: convId,
                    agentId,
                    userId,
                    deliveryPlatform: deliveryPlatform || 'web',
                    telegramChatId: telegramChatId || null,
                    defaultEmailTo: defaultEmailTo || userEmail || null,
                    userEmail: userEmail || null,
                    chain: requestedChain,
                    apiKey: req.headers['x-api-key'] || process.env.MASTER_API_KEY || null
                  }
                );
                
                // Map directExecResult to runtime format
                return {
                  agent_response: formatToolResponse(directExecResult),
                  tool_calls: directExecResult.tool_calls,
                  results: directExecResult.results
                };
              }
            );

            if (runtimeResult && runtimeResult.results && runtimeResult.results.length > 0) {
              const successCount = runtimeResult.results.filter(r => r.success).length;
              console.log('[Chat] Direct tool execution fallback completed:', `${successCount}/${runtimeResult.results.length} successful`);
              aiResponse = runtimeResult.agent_response;
              toolResults = {
                tool_calls: runtimeResult.tool_calls,
                results: runtimeResult.results,
                routing_plan: routingPlan,
                execution_mode: 'direct_fallback',
                runtime: {
                  onChainId: runtimeResult.onChainId,
                  decision: runtimeResult.decision,
                  verification: runtimeResult.verification,
                  agent_log: runtime.exportLogs() // Added standard agent_log.json
                }
              };
            } else {
              aiResponse = `I could not execute the requested blockchain actions because the execution backend is unavailable right now. No transfer or email was sent. Please retry in a moment.`;
            }
          } catch (directError) {
            console.error('[Chat] Direct tool execution failed:', directError.message);
            aiResponse = `I could not execute the requested blockchain actions because the execution backend is unavailable right now. No transfer or email was sent. Please retry in a moment.`;
          }
        }
      }
    } else {
      // Simple conversational response (no tools needed)
      console.log('[Chat] Simple conversation, using direct AI');
      
      const defaultSystemPrompt = systemPrompt || 
        `You are a specialized blockchain operations assistant for BlockOps with Flow EVM Testnet as the default execution chain and Arbitrum Sepolia available for legacy tools. You help with: cryptocurrency prices, wallet operations, automation, smart contracts, blockchain transactions, and email notifications.
        
        CRITICAL: If the user asks a question that requires blockchain data (prices, balances, calculations), and you don't have tools available, tell them what you would need to look up and suggest they ask directly (e.g., "fetch price of ETH", "check balance of 0x..."). 
        
        When data from previous messages is available in the conversation, USE IT to answer follow-up questions. If the user says "calculate" or "how much" after previous data was discussed, perform the calculation using that data.
        
        If asked about topics unrelated to blockchain or email notifications, respond: "I'm a blockchain operations assistant and can only help with blockchain-related tasks and email notifications. Please ask me something about cryptocurrency, tokens, NFTs, blockchain operations, or sending an email."
        
        Provide clear, accurate, and concise responses. Use **bold** formatting sparingly.`;
      
      const { context, tokenCount } = buildContext(messages, defaultSystemPrompt);
      aiResponse = await chatWithAI(context);
    }

    if (toolResults && Array.isArray(toolResults.results) && toolResults.results.length > 0) {
      try {
        const auditPromise = archiveToolExecutionLogs({
          agentId,
          userId,
          conversationId: convId,
          message: truncatedMessage,
          toolResults,
          routingPlan
        });

        let auditCompletedWithinBudget = false;
        const auditWaitMs = getAuditWaitMs();

        executionAudit = await Promise.race([
          auditPromise.then((audit) => {
            auditCompletedWithinBudget = true;
            return audit;
          }),
          new Promise((resolve) => {
            setTimeout(() => resolve(null), auditWaitMs);
          })
        ]);

        if (!auditCompletedWithinBudget || !executionAudit) {
          executionAudit = createPendingExecutionAudit(toolResults);

          auditPromise
            .then((finalAudit) => {
              if (finalAudit?.totalCount) {
                console.log('[Chat] Filecoin archival completed asynchronously:', {
                  totalCount: finalAudit.totalCount,
                  filecoinStoredCount: finalAudit.filecoinStoredCount
                });
              }
            })
            .catch((archiveError) => {
              console.error('[Chat] Async Filecoin archival failed:', archiveError.message);
            });
        }

        const auditText = formatExecutionAuditForChat(executionAudit);
        if (auditText) {
          aiResponse = `${aiResponse}\n\n${auditText}`;
        }
      } catch (auditError) {
        console.error('[Chat] Failed to archive execution logs:', auditError.message);
      }
    }

    if (toolResults) {
      toolResults = sanitizeToolResultsForResponse(toolResults);
      if (executionAudit) {
        toolResults.execution_audit = executionAudit;
      }
    }

    // Save AI response (if Supabase is configured)
    if (useSupabase) {
      const { error: aiMsgError } = await supabase
        .from('conversation_messages')
        .insert({ 
          conversation_id: convId, 
          role: 'assistant', 
          content: aiResponse,
          tool_calls: toolResults
        });

      if (aiMsgError) {
        console.error('Error saving AI message:', aiMsgError);
        // Don't throw - we already have the response
      }
    } else {
      addInMemoryMessage(convId, 'assistant', aiResponse, toolResults);
      console.log('[Chat] AI response generated and stored in memory');
    }

    // Return response
    res.json({
      conversationId: convId,
      message: aiResponse,
      isNewConversation,
      messageCount: useSupabase ? messages.length + 1 : getInMemoryMessages(convId).length,
      toolResults,
      executionAudit,
      hasTools: !!toolResults,
      memoryMode: useSupabase ? 'persistent' : 'temporary'
    });

  } catch (error) {
    console.error('[Chat] Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process message' 
    });
  }
}

/**
 * List user's conversations
 * GET /api/conversations?userId=xxx&agentId=xxx&limit=20
 */
async function listConversations(req, res) {
  if (!supabase) {
    return res.json({ 
      conversations: [], 
      count: 0,
      message: 'Conversation history not available (Supabase not configured)' 
    });
  }

  try {
    const { userId, agentId, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }

    let query = supabase
      .from('conversations')
      .select('id, agent_id, title, message_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit));

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error listing conversations:', error);
      throw new Error('Failed to list conversations');
    }

    res.json({ 
      conversations: data,
      count: data.length 
    });

  } catch (error) {
    console.error('[List Conversations] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get messages for a conversation
 * GET /api/conversations/:conversationId/messages
 */
async function getMessages(req, res) {
  try {
    const { conversationId } = req.params;
    const { limit = 50 } = req.query;
    const parsedLimit = parseInt(limit, 10);
    const finalLimit = Number.isNaN(parsedLimit) ? 50 : parsedLimit;

    if (!isUuidLike(conversationId) || hasInMemoryConversation(conversationId)) {
      const messages = getInMemoryMessages(conversationId).slice(-finalLimit);
      return res.json({
        messages,
        count: messages.length,
        memoryMode: true
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        error: 'Conversation service not available. Supabase not configured.' 
      });
    }

    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, role, content, tool_calls, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(finalLimit);

    if (error) {
      console.error('Error getting messages:', error);
      throw new Error('Failed to get messages');
    }

    res.json({ 
      messages: data,
      count: data.length 
    });

  } catch (error) {
    console.error('[Get Messages] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get a single conversation
 * GET /api/conversations/:conversationId
 */
async function getConversation(req, res) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Conversation service not available. Supabase not configured.' 
    });
  }

  try {
    const { conversationId } = req.params;

    const { data, error } = await supabase
      .from('conversations')
      .select('id, agent_id, user_id, title, message_count, created_at, updated_at')
      .eq('id', conversationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      throw error;
    }

    res.json({ conversation: data });

  } catch (error) {
    console.error('[Get Conversation] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Delete a conversation
 * DELETE /api/conversations/:conversationId
 */
async function deleteConversation(req, res) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Conversation service not available. Supabase not configured.' 
    });
  }

  try {
    const { conversationId } = req.params;

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('Error deleting conversation:', error);
      throw new Error('Failed to delete conversation');
    }

    res.json({ 
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    console.error('[Delete Conversation] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Update conversation title
 * PATCH /api/conversations/:conversationId
 */
async function updateConversation(req, res) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Conversation service not available. Supabase not configured.' 
    });
  }

  try {
    const { conversationId } = req.params;
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Missing title' });
    }

    const { data, error } = await supabase
      .from('conversations')
      .update({ title: title.slice(0, 200) })
      .eq('id', conversationId)
      .select()
      .single();

    if (error) {
      console.error('Error updating conversation:', error);
      throw new Error('Failed to update conversation');
    }

    res.json({ 
      conversation: data,
      message: 'Title updated successfully'
    });

  } catch (error) {
    console.error('[Update Conversation] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get database statistics (admin only)
 * GET /api/admin/stats
 */
async function getStats(req, res) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Conversation service not available. Supabase not configured.' 
    });
  }

  try {
    // Check admin authorization
    const authHeader = req.headers.authorization;
    const expectedAuth = process.env.ADMIN_SECRET 
      ? `Bearer ${process.env.ADMIN_SECRET}`
      : null;

    if (!expectedAuth || authHeader !== expectedAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase.rpc('get_database_stats');

    if (error) {
      console.error('Error getting stats:', error);
      throw new Error('Failed to get statistics');
    }

    res.json({ stats: data[0] || {} });

  } catch (error) {
    console.error('[Get Stats] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Manual cleanup endpoint (admin only)
 * POST /api/admin/cleanup
 */
async function runCleanup(req, res) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Conversation service not available. Supabase not configured.' 
    });
  }

  try {
    // Check admin authorization
    const authHeader = req.headers.authorization;
    const expectedAuth = process.env.ADMIN_SECRET 
      ? `Bearer ${process.env.ADMIN_SECRET}`
      : null;

    if (!expectedAuth || authHeader !== expectedAuth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const maxDelete = req.body.maxDelete || 100;

    const { data, error } = await supabase.rpc('delete_stale_conversations', {
      max_delete: maxDelete
    });

    if (error) {
      console.error('Error running cleanup:', error);
      throw new Error('Failed to run cleanup');
    }

    const deletedCount = data[0]?.deleted_count || 0;

    res.json({ 
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} stale conversation(s)`
    });

  } catch (error) {
    console.error('[Cleanup] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  chat,
  listConversations,
  getMessages,
  getConversation,
  deleteConversation,
  updateConversation,
  getStats,
  runCleanup,
  isUuidLike,
  hasInMemoryConversation,
  appendAssistantMessageToConversation,
  getInMemoryMessages
};

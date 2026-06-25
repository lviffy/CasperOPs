const { randomUUID } = require('crypto');
const supabase = require('../config/supabase');
const { NETWORK_NAME } = require('../config/constants');
const { logger } = require('../utils/logger');

const log = logger.child({ component: 'toolAuditLogService' });

const SENSITIVE_KEY_REGEX = /(private[_-]?key|mnemonic|seed|passphrase|password|secret|api[_-]?key|authorization|token|jwt|signature)/i;
const SENSITIVE_VALUE_CONTEXT_REGEX = /(private[_-]?key|mnemonic|seed|passphrase|secret|wallet[_-]?key)/i;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

const CHAIN_ID_MAP = {
  1: 'ethereum-mainnet',
  11155111: 'ethereum-sepolia',
  42161: 'arbitrum-mainnet',
  421614: 'arbitrum-sepolia'
};

function sanitizeErrorMessage(value) {
  const text = String(value || '');
  return text
    .replace(/(private[_\s-]?key\s*[:=]?\s*)0x[a-fA-F0-9]{64}/gi, '$1[REDACTED_PRIVATE_KEY]')
    .replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]');
}

function shouldRedactHex64(value, keyHint = '') {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!PRIVATE_KEY_REGEX.test(trimmed)) {
    return false;
  }

  if (!keyHint) {
    return false;
  }

  return SENSITIVE_VALUE_CONTEXT_REGEX.test(String(keyHint));
}

function sanitizeValue(value, seen = new WeakSet(), keyHint = '') {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (shouldRedactHex64(value, keyHint)) {
      return '[REDACTED_PRIVATE_KEY]';
    }
    return sanitizeErrorMessage(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, keyHint));
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    sanitized[key] = sanitizeValue(nestedValue, seen, key);
  }

  return sanitized;
}

function sanitizeParams(params) {
  return sanitizeValue(params || {});
}

function pickFirstDefined(values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    return value;
  }

  return null;
}

function normalizeChainValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' && CHAIN_ID_MAP[value]) {
    return CHAIN_ID_MAP[value];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericChainId = Number(trimmed);
      if (CHAIN_ID_MAP[numericChainId]) {
        return CHAIN_ID_MAP[numericChainId];
      }
    }

    return trimmed;
  }

  return null;
}

function findFirstByKeyPattern(value, keyPattern, depth = 0, seen = new WeakSet()) {
  if (depth > 4 || value === null || value === undefined || typeof value !== 'object') {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keyPattern.test(key) && (typeof nestedValue === 'string' || typeof nestedValue === 'number')) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === 'object') {
      const found = findFirstByKeyPattern(nestedValue, keyPattern, depth + 1, seen);
      if (found !== null && found !== undefined) {
        return found;
      }
    }
  }

  return null;
}

function extractTxHash(rawResultPayload = {}) {
  const txHash = pickFirstDefined([
    rawResultPayload.transactionHash,
    rawResultPayload.txHash,
    rawResultPayload.tx_hash,
    rawResultPayload.hash,
    rawResultPayload.transaction?.hash,
    rawResultPayload.receipt?.transactionHash,
    rawResultPayload.receipt?.txHash,
    findFirstByKeyPattern(rawResultPayload, /^(tx_?hash|transaction_?hash)$/i)
  ]);

  return txHash ? String(txHash) : null;
}

function extractAmount(rawResultPayload = {}, sanitizedParams = {}) {
  const amount = pickFirstDefined([
    rawResultPayload.amount,
    rawResultPayload.value,
    rawResultPayload.details?.amount,
    rawResultPayload.swap?.tokenIn?.amount,
    rawResultPayload.swap?.tokenOut?.quotedAmount,
    sanitizedParams.amount,
    sanitizedParams.amountIn,
    sanitizedParams.value
  ]);

  return amount === null || amount === undefined ? null : String(amount);
}

function detectChain(rawParams = {}, rawResultPayload = {}) {
  const chainValue = pickFirstDefined([
    rawResultPayload.chain,
    rawResultPayload.network,
    rawResultPayload.chainId,
    rawResultPayload.chain_id,
    rawResultPayload.sourceChain,
    rawResultPayload.destinationChain,
    rawResultPayload.l1Chain,
    rawResultPayload.l2Chain,
    rawParams.chain,
    rawParams.network,
    rawParams.chainId,
    rawParams.chain_id,
    rawParams.sourceChain,
    rawParams.destinationChain
  ]);

  return normalizeChainValue(chainValue) || NETWORK_NAME || 'arbitrum-sepolia';
}

function truncateMessage(message, maxLength = 280) {
  const text = String(message || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function buildResultSummary(resultRecord = {}, sanitizedParams = {}) {
  const rawResultPayload =
    resultRecord?.result && typeof resultRecord.result === 'object'
      ? resultRecord.result
      : resultRecord?.result ?? null;

  const success = resultRecord?.success === true;
  const status = pickFirstDefined([
    rawResultPayload?.status,
    rawResultPayload?.receipt?.status,
    success ? 'success' : 'failed'
  ]);

  return {
    success,
    status: String(status || (success ? 'success' : 'failed')),
    txHash: extractTxHash(rawResultPayload || {}),
    amount: extractAmount(rawResultPayload || {}, sanitizedParams),
    explorerUrl: pickFirstDefined([
      rawResultPayload?.explorerUrl,
      rawResultPayload?.explorer,
      rawResultPayload?.txUrl
    ]),
    prepared: Boolean(rawResultPayload?.prepared || rawResultPayload?.requiresSigning),
    requiresSigning: Boolean(rawResultPayload?.requiresSigning),
    error: success ? null : sanitizeErrorMessage(resultRecord?.error || 'Execution failed'),
    data: sanitizeValue(rawResultPayload)
  };
}

async function persistAuditLog(record) {
  if (!supabase) {
    return { data: null, error: null };
  }

  return supabase
    .from('agent_tool_execution_logs')
    .insert(record)
    .select('id')
    .single();
}


async function archiveToolExecutionLogs({
  agentId,
  userId,
  conversationId,
  message,
  toolResults,
  routingPlan = null
}) {
  const toolCalls = Array.isArray(toolResults?.tool_calls) ? toolResults.tool_calls : [];
  const results = Array.isArray(toolResults?.results) ? toolResults.results : [];
  const total = Math.max(toolCalls.length, results.length);

  if (!total) {
    log.debug({ agentId, userId }, 'archiveToolExecutionLogs: nothing to archive');
    return {
      totalCount: 0,
      successfulCount: 0,
      entries: []
    };
  }

  log.info({
    agentId,
    userId,
    conversationId,
    totalCount: total,
  }, 'archiving tool execution logs');

  const executionMode = toolResults?.execution_mode || 'agent_backend';
  const entries = [];

  for (let index = 0; index < total; index += 1) {
    const toolCall = toolCalls[index] || {};
    const resultRecord = results[index] || {};
    const toolName = toolCall.tool || resultRecord.tool || `tool_step_${index + 1}`;

    const sanitizedParameters = sanitizeParams(toolCall.parameters || {});
    const resultSummary = buildResultSummary(resultRecord, sanitizedParameters);
    const chain = detectChain(toolCall.parameters || {}, resultRecord.result || {});
    const timestamp = new Date().toISOString();

    const auditPayload = {
      schemaVersion: '1.0',
      logType: 'tool_execution',
      agentId: String(agentId),
      userId: String(userId),
      conversationId: conversationId || null,
      timestamp,
      tool: toolName,
      chain,
      params: sanitizedParameters,
      result: resultSummary,
      metadata: {
        executionMode,
        toolIndex: index + 1,
        totalTools: total,
        requestExcerpt: truncateMessage(message),
        routingType: routingPlan?.execution_plan?.type || null,
        routingComplexity: routingPlan?.complexity || null
      }
    };

    // Filecoin archival was removed when CasperOPs migrated off EVM/RWA.
    // The audit log itself is persisted to Supabase below.
    const dbRecord = {
      agent_id: String(agentId),
      user_id: String(userId),
      conversation_id: conversationId || null,
      message_excerpt: truncateMessage(message),
      execution_mode: executionMode,
      tool_name: toolName,
      tool_index: index + 1,
      chain,
      params_sanitized: sanitizedParameters,
      result_summary: resultSummary,
      raw_result: sanitizeValue(resultRecord.result),
      success: Boolean(resultSummary.success),
      tx_hash: resultSummary.txHash,
      amount: resultSummary.amount,
      created_at: timestamp
    };

    let recordId = randomUUID();
    let dbError = null;
    const { data, error } = await persistAuditLog(dbRecord);
    if (data?.id) {
      recordId = data.id;
    }
    if (error) {
      dbError = error.message;
      log.error({ err: error.message, tool: toolName, agentId, recordId }, 'audit log persist failed');
    }

    entries.push({
      id: recordId,
      tool: toolName,
      success: Boolean(resultSummary.success),
      chain,
      timestamp,
      txHash: resultSummary.txHash,
      amount: resultSummary.amount,
      dbError
    });
  }

  return {
    totalCount: entries.length,
    successfulCount: entries.filter((entry) => entry.success).length,
    entries
  };
}

function sanitizeToolResultsForResponse(toolResults) {
  if (!toolResults || typeof toolResults !== 'object') {
    return toolResults;
  }

  return {
    ...toolResults,
    tool_calls: Array.isArray(toolResults.tool_calls)
      ? toolResults.tool_calls.map((toolCall) => ({
          ...toolCall,
          parameters: sanitizeParams(toolCall?.parameters || {})
        }))
      : [],
    results: Array.isArray(toolResults.results)
      ? toolResults.results.map((result) => ({
          ...result,
          error: result?.error ? sanitizeErrorMessage(result.error) : result?.error,
          result: sanitizeValue(result?.result)
        }))
      : []
  };
}

function formatExecutionAuditForChat(executionAudit) {
  if (!executionAudit?.entries?.length) {
    return '';
  }

  const lines = ['Tool execution log:'];
  executionAudit.entries.forEach((entry, index) => {
    const status = entry.success ? 'success' : 'failed';
    const txLabel = entry.txHash ? `tx ${entry.txHash}` : 'tx n/a';
    lines.push(`${index + 1}. ${entry.tool} | ${status} | ${txLabel}`);
  });

  return lines.join('\n');
}

module.exports = {
  archiveToolExecutionLogs,
  formatExecutionAuditForChat,
  sanitizeParams,
  sanitizeToolResultsForResponse
};

const cron = require('node-cron');
const supabase = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const { executeToolsDirectly, formatToolResponse } = require('../services/directToolExecutor');
const { fireToTelegram } = require('../services/telegramService');
const { getChainFromRequest, getChainMetadata, normalizeChainId, isFlowChain } = require('../utils/chains');
const {
  isUuidLike,
  hasInMemoryConversation,
  appendAssistantMessageToConversation
} = require('./conversationController');

const activeReminderTasks = new Map();

function isSupabaseConnectivityError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return message.includes('fetch failed') || message.includes('eacces')
    || details.includes('fetch failed') || details.includes('eacces');
}

function listInMemoryReminderJobs() {
  return Array.from(activeReminderTasks.keys()).map((id) => ({
    id,
    status: 'active',
    liveStatus: 'running',
    note: 'in-memory fallback'
  }));
}

function isOneShot(expr) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(expr || ''));
}

function normalizeIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeCancelMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'all' ? 'all' : 'latest';
}

function normalizeOnlyActive(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return String(value).toLowerCase() !== 'false';
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

async function fetchReminderCandidates(filters = {}) {
  const {
    ids = [],
    userId = null,
    agentId = null,
    conversationId = null,
    taskType = null,
    walletAddress = null,
    onlyActive = true
  } = filters;

  if (!supabase) {
    const activeIds = Array.from(activeReminderTasks.keys());
    let candidates = activeIds.map((id) => ({
      id,
      status: 'active',
      created_at: new Date(0).toISOString()
    }));

    if (ids.length > 0) {
      const idSet = new Set(ids);
      candidates = candidates.filter((job) => idSet.has(job.id));
    }

    return candidates;
  }

  let query = supabase
    .from('scheduled_chat_reminders')
    .select('id, agent_id, user_id, conversation_id, task_type, wallet_address, cron_expression, type, status, created_at')
    .order('created_at', { ascending: false });

  if (ids.length > 0) query = query.in('id', ids);
  if (onlyActive) query = query.eq('status', 'active');
  if (userId) query = query.eq('user_id', userId);
  if (agentId) query = query.eq('agent_id', agentId);
  if (conversationId) query = query.eq('conversation_id', conversationId);
  if (taskType) query = query.eq('task_type', taskType);
  if (walletAddress) query = query.ilike('wallet_address', walletAddress);

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function cancelReminderById(reminderId) {
  if (activeReminderTasks.has(reminderId)) {
    activeReminderTasks.get(reminderId).stop();
    activeReminderTasks.delete(reminderId);
  }

  if (supabase) {
    const { error } = await supabase
      .from('scheduled_chat_reminders')
      .delete()
      .eq('id', reminderId);

    if (error) {
      throw new Error(error.message);
    }
  }
}

function validateReminderJob(job) {
  const errors = [];

  if (!job.task_type || !['balance', 'portfolio', 'price'].includes(job.task_type)) {
    errors.push('taskType must be one of: balance, portfolio, price');
  }

  if (!job.cron_expression) {
    errors.push('cronExpression is required');
  }

  if (job.task_type !== 'price' && !job.wallet_address) {
    errors.push('walletAddress is required for balance and portfolio reminders');
  }

  if (job.task_type === 'price' && !job.token_query) {
    errors.push('tokenQuery is required for price reminders');
  }

  if (!job.user_id) {
    errors.push('userId is required');
  }

  if (job.delivery_platform === 'web' && !job.conversation_id) {
    errors.push('conversationId is required for web reminders');
  }

  if (job.delivery_platform === 'telegram' && !job.telegram_chat_id) {
    errors.push('telegramChatId is required for Telegram reminders');
  }

  return errors;
}

function buildReminderExecutionPlan(job) {
  const chain = normalizeChainId(job.chain || 'arbitrum-sepolia');
  switch (job.task_type) {
    case 'balance':
      return {
        type: 'parallel',
        steps: [
          {
            tool: 'get_balance',
            reason: 'Fetch the latest ETH balance for the scheduled wallet check',
            parameters: { address: job.wallet_address, chain },
            depends_on: []
          }
        ]
      };
    case 'portfolio':
      return {
        type: 'parallel',
        steps: [
          {
            tool: 'get_portfolio',
            reason: 'Fetch the latest wallet portfolio snapshot for the scheduled reminder',
            parameters: { address: job.wallet_address, chain },
            depends_on: []
          }
        ]
      };
    case 'price':
      return {
        type: 'parallel',
        steps: [
          {
            tool: 'fetch_price',
            reason: 'Fetch the latest token price for the scheduled reminder',
            parameters: { query: job.token_query, chain },
            depends_on: []
          }
        ]
      };
    default:
      return { type: 'parallel', steps: [] };
  }
}

function buildReminderMessage(job, toolResults) {
  const headline = job.label
    ? `${job.label}\n`
    : job.task_type === 'balance'
      ? 'Scheduled balance update\n'
      : job.task_type === 'portfolio'
        ? 'Scheduled wallet value update\n'
        : 'Scheduled price update\n';

  return `${headline}${formatToolResponse(toolResults)}`.trim();
}

async function persistReminderDeliveryToConversation(job, message, toolResults) {
  if (!job.conversation_id) {
    return;
  }

  if (hasInMemoryConversation(job.conversation_id)) {
    appendAssistantMessageToConversation(job.conversation_id, message, toolResults);
    return;
  }

  if (!supabase || !isUuidLike(job.conversation_id)) {
    return;
  }

  const { error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: job.conversation_id,
      role: 'assistant',
      content: message,
      tool_calls: toolResults
    });

  if (error) {
    console.error('[Reminder] Failed to persist reminder message to conversation:', error.message);
  }
}

async function persistReminderLog(jobId, payload) {
  if (!supabase) return;

  const { error } = await supabase
    .from('scheduled_chat_reminder_logs')
    .insert({
      reminder_id: jobId,
      ran_at: new Date().toISOString(),
      success: payload.success,
      message_text: payload.messageText || null,
      error: payload.error || null,
      tool_results: payload.toolResults || null
    });

  if (error) {
    console.error('[Reminder] Failed to persist reminder log:', error.message);
  }
}

async function updateReminderRow(jobId, updatePayload) {
  if (!supabase) return;

  const { error } = await supabase
    .from('scheduled_chat_reminders')
    .update({
      ...updatePayload,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) {
    console.error('[Reminder] Failed to update reminder row:', error.message);
  }
}

async function runReminder(job) {
  const executionPlan = buildReminderExecutionPlan(job);
  let toolResults = {
    tool_calls: [],
    results: []
  };
  let reminderMessage = '';
  let lastError = null;

  try {
    const directExecResult = await executeToolsDirectly(
      { execution_plan: executionPlan },
      job.original_message || '',
      {
        walletAddress: job.wallet_address || null,
        chain: normalizeChainId(job.chain || 'arbitrum-sepolia'),
        apiKey: process.env.MASTER_API_KEY || null
      }
    );

    toolResults = {
      tool_calls: directExecResult.tool_calls || [],
      results: directExecResult.results || []
    };

    reminderMessage = buildReminderMessage(job, toolResults);

    if (job.delivery_platform === 'telegram' && job.telegram_chat_id) {
      await fireToTelegram(job.telegram_chat_id, reminderMessage);
    }

    if (job.delivery_platform === 'web') {
      await persistReminderDeliveryToConversation(job, reminderMessage, toolResults);
    }
  } catch (error) {
    lastError = error.message || 'Reminder execution failed';
    reminderMessage = `Scheduled reminder failed: ${lastError}`;

    if (job.delivery_platform === 'telegram' && job.telegram_chat_id) {
      await fireToTelegram(job.telegram_chat_id, reminderMessage).catch(() => {});
    }

    if (job.delivery_platform === 'web') {
      await persistReminderDeliveryToConversation(job, reminderMessage, toolResults);
    }
  }

  const success = !lastError && (toolResults.results || []).every((result) => result?.success !== false);
  job.run_count = (job.run_count || 0) + 1;
  job.last_run_at = new Date().toISOString();
  job.last_error = lastError;
  job.last_result_summary = reminderMessage;

  await updateReminderRow(job.id, {
    last_run_at: new Date().toISOString(),
    run_count: job.run_count,
    last_error: lastError,
    last_result_summary: reminderMessage
  });

  await persistReminderLog(job.id, {
    success,
    messageText: reminderMessage,
    error: lastError,
    toolResults
  });
}

function registerReminderTask(job) {
  if (activeReminderTasks.has(job.id)) {
    activeReminderTasks.get(job.id).stop();
    activeReminderTasks.delete(job.id);
  }

  if (job.status !== 'active') return;

  if (isOneShot(job.cron_expression)) {
    const target = new Date(job.cron_expression).getTime();
    if (!Number.isFinite(target)) {
      console.warn(`[Reminder] One-shot reminder ${job.id} has an invalid datetime: ${job.cron_expression}`);
      return;
    }
    const delay = target - Date.now();

    if (delay <= 0) {
      console.warn(`[Reminder] One-shot reminder ${job.id} is in the past, skipping registration.`);
      return;
    }

    const timer = setTimeout(async () => {
      await runReminder(job);
      await updateReminderRow(job.id, { status: 'completed' });
      activeReminderTasks.delete(job.id);
    }, delay);

    activeReminderTasks.set(job.id, { stop: () => clearTimeout(timer) });
  } else {
    if (!cron.validate(job.cron_expression)) {
      console.warn(`[Reminder] Invalid cron expression for reminder ${job.id}: ${job.cron_expression}`);
      return;
    }

    const task = cron.schedule(job.cron_expression, () => runReminder(job), { timezone: 'UTC' });
    activeReminderTasks.set(job.id, task);
  }

  console.log(`[Reminder] Registered reminder ${job.id} (${job.task_type}) with schedule "${job.cron_expression}"`);
}

async function reloadReminderJobsFromDB() {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('scheduled_chat_reminders')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;

    (data || []).forEach(registerReminderTask);
    console.log(`[Reminder] Restored ${(data || []).length} active reminder job(s) from DB.`);
  } catch (error) {
    console.error('[Reminder] Failed to restore reminder jobs:', error.message);
  }
}

async function createReminder(req, res) {
  try {
    const {
      taskType,
      walletAddress,
      tokenQuery,
      cronExpression,
      label,
      originalMessage,
      userId,
      conversationId,
      deliveryPlatform,
      telegramChatId
    } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    const oneShot = isOneShot(cronExpression);
    const agentId = req.body.agentId || req.apiKey?.agentId || null;

    const reminderRow = {
      agent_id: agentId,
      user_id: userId,
      conversation_id: conversationId || null,
      delivery_platform: deliveryPlatform || 'web',
      telegram_chat_id: telegramChatId || null,
      task_type: taskType,
      chain,
      wallet_address: walletAddress || null,
      token_query: tokenQuery || null,
      cron_expression: cronExpression,
      label: label || null,
      original_message: originalMessage || null,
      type: oneShot ? 'one_shot' : 'recurring',
      status: 'active',
      run_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const validationErrors = validateReminderJob(reminderRow);
    if (validationErrors.length > 0) {
      return res.status(400).json(errorResponse(validationErrors.join('. ')));
    }

    if (taskType === 'portfolio' && isFlowChain(chain)) {
      return res.status(400).json(errorResponse('Portfolio reminders are available on Arbitrum Sepolia only in the current build.'));
    }

    if (reminderRow.delivery_platform === 'web') {
      const canUsePersistentConversation = !!supabase && isUuidLike(reminderRow.conversation_id);
      const canUseMemoryConversation = !!reminderRow.conversation_id && hasInMemoryConversation(reminderRow.conversation_id);

      if (!canUsePersistentConversation && !canUseMemoryConversation) {
        return res.status(400).json(errorResponse('Web reminders need an active conversation id from this chat session.'));
      }
    }

    if (!oneShot && !cron.validate(cronExpression)) {
      return res.status(400).json(errorResponse(
        `Invalid cronExpression "${cronExpression}". Use a 5-field cron string or an ISO datetime string.`
      ));
    }

    if (oneShot && Number.isNaN(new Date(cronExpression).getTime())) {
      return res.status(400).json(errorResponse('Invalid one-shot datetime. Use a valid ISO datetime string.'));
    }

    let reminderId;
    let storedReminder = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('scheduled_chat_reminders')
        .insert(reminderRow)
        .select()
        .single();

      if (error) throw new Error(`DB insert failed: ${error.message}`);
      reminderId = data.id;
      storedReminder = data;
      registerReminderTask(data);
    } else {
      reminderId = `mem_${Date.now()}`;
      storedReminder = { ...reminderRow, id: reminderId };
      registerReminderTask(storedReminder);
    }

    const targetDescription = taskType === 'price'
      ? `${tokenQuery} price`
      : `${walletAddress} ${taskType}`;

    return res.status(201).json(successResponse({
      id: reminderId,
      type: storedReminder.type,
      status: storedReminder.status,
      taskType,
      chain,
      chainId: chainMetadata.chainId,
      network: chainMetadata.network,
      walletAddress: walletAddress || null,
      tokenQuery: tokenQuery || null,
      cronExpression,
      label: storedReminder.label,
      deliveryPlatform: storedReminder.delivery_platform,
      note: oneShot
        ? `Reminder scheduled once for ${new Date(cronExpression).toISOString()}`
        : `Reminder scheduled for ${targetDescription} on "${cronExpression}" (UTC)`
    }));
  } catch (error) {
    console.error('[Reminder] createReminder error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function listReminders(req, res) {
  try {
    if (!supabase) {
      const jobs = listInMemoryReminderJobs();
      return res.json(successResponse({ jobs, total: jobs.length }));
    }

    const userId = req.query.userId || req.body?.userId || null;
    const agentId = req.apiKey?.agentId || req.query.agentId || null;
    const includeInactive = normalizeBoolean(req.query.includeInactive ?? req.body?.includeInactive, false);

    let query = supabase
      .from('scheduled_chat_reminders')
      .select('id, agent_id, user_id, conversation_id, delivery_platform, telegram_chat_id, task_type, chain, wallet_address, token_query, cron_expression, label, type, status, run_count, last_run_at, last_error, last_result_summary, created_at')
      .order('created_at', { ascending: false });

    if (userId) query = query.eq('user_id', userId);
    if (agentId) query = query.eq('agent_id', agentId);
    if (!includeInactive) query = query.eq('status', 'active');

    const { data, error } = await query;
    if (error) throw error;

    const jobs = (data || []).map((job) => ({
      ...job,
      liveStatus: activeReminderTasks.has(job.id) ? 'running' : (job.status === 'active' ? 'pending_reload' : job.status)
    }));

    return res.json(successResponse({ jobs, total: jobs.length, includeInactive }));
  } catch (error) {
    console.error('[Reminder] listReminders error:', error);
    if (isSupabaseConnectivityError(error)) {
      const jobs = listInMemoryReminderJobs();
      return res.json(successResponse({
        jobs,
        total: jobs.length,
        includeInactive: true,
        degraded: true,
        warning: 'Supabase unreachable; returning in-memory reminders only.'
      }));
    }

    return res.status(500).json(errorResponse(error.message));
  }
}

async function getReminder(req, res) {
  try {
    if (!supabase) {
      return res.status(503).json(errorResponse('Supabase not configured'));
    }

    const { id } = req.params;
    const { data, error } = await supabase
      .from('scheduled_chat_reminders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json(errorResponse('Reminder not found'));
    }

    const { data: logs } = await supabase
      .from('scheduled_chat_reminder_logs')
      .select('ran_at, success, message_text, error')
      .eq('reminder_id', id)
      .order('ran_at', { ascending: false })
      .limit(10);

    return res.json(successResponse({
      ...data,
      logs: logs || [],
      liveStatus: activeReminderTasks.has(id) ? 'running' : data.status
    }));
  } catch (error) {
    console.error('[Reminder] getReminder error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function cancelReminder(req, res) {
  try {
    const body = req.body || {};
    const query = req.query || {};

    const paramId = req.params?.id;
    const id = (paramId && paramId !== 'undefined')
      ? paramId
      : (body.id || query.id || null);
    const ids = normalizeIdList(body.ids || query.ids);
    const mode = normalizeCancelMode(body.mode || query.mode);
    const userId = body.userId || query.userId || null;
    const agentId = body.agentId || req.apiKey?.agentId || query.agentId || null;
    const conversationId = body.conversationId || query.conversationId || null;
    const taskType = body.taskType || body.task_type || query.taskType || query.task_type || null;
    const walletAddress =
      body.walletAddress ||
      body.wallet_address ||
      body.address ||
      query.walletAddress ||
      query.wallet_address ||
      query.address ||
      null;
    const onlyActive = normalizeOnlyActive(body.onlyActive ?? query.onlyActive, true);

    const explicitIds = [...new Set([id, ...ids].filter(Boolean))];
    let candidates = [];

    if (explicitIds.length > 0) {
      candidates = await fetchReminderCandidates({
        ids: explicitIds,
        userId,
        agentId,
        conversationId,
        taskType,
        walletAddress,
        onlyActive: false
      });
    } else {
      candidates = await fetchReminderCandidates({
        ids: [],
        userId,
        agentId,
        conversationId,
        taskType,
        walletAddress,
        onlyActive
      });
    }

    if (candidates.length === 0) {
      return res.status(404).json(errorResponse('No matching active reminder found to cancel.'));
    }

    const selectedCandidates = mode === 'all' ? candidates : [candidates[0]];
    const selectedIds = [...new Set(selectedCandidates.map((job) => job.id).filter(Boolean))];

    for (const reminderId of selectedIds) {
      await cancelReminderById(reminderId);
    }

    if (selectedIds.length === 1) {
      return res.json(successResponse({
        id: selectedIds[0],
        cancelledIds: selectedIds,
        cancelledCount: 1,
        status: 'cancelled',
        mode,
        message: 'Reminder cancelled.'
      }));
    }

    return res.json(successResponse({
      cancelledIds: selectedIds,
      cancelledCount: selectedIds.length,
      status: 'cancelled',
      mode,
      message: `Cancelled ${selectedIds.length} reminder(s).`
    }));
  } catch (error) {
    console.error('[Reminder] cancelReminder error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  createReminder,
  listReminders,
  getReminder,
  cancelReminder,
  reloadReminderJobsFromDB,
  registerReminderTask
};

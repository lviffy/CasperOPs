/**
 * Schedule Controller — One-time and recurring on-chain transfers
 *
 * POST   /schedule/transfer        — create a scheduled transfer
 * GET    /schedule                 — list all scheduled transfers for the agent
 * GET    /schedule/:id             — get a single scheduled transfer
 * DELETE /schedule/:id             — cancel (delete) a scheduled transfer
 * POST   /schedule/:id/pause       — pause a recurring job
 * POST   /schedule/:id/resume      — resume a paused recurring job
 *
 * Storage: Supabase `scheduled_transfers` table (see schema in database/schema.sql)
 * Engine:  node-cron (in-process). Jobs are reloaded from DB on server start.
 *
 * Body params for POST /schedule/transfer:
 *   privateKey       — server-side signer key
 *   toAddress        — recipient address
 *   amount           — human-readable ETH amount (e.g. "0.01")
 *   tokenAddress     — optional ERC20 address; omit for native ETH
 *   cronExpression   — standard 5-field cron (e.g. "0 9 * * 1" = every Monday 9am UTC)
 *                      OR ISO-8601 datetime string for a one-shot run
 *                      OR relative phrase like "in 5 minutes" / "after 2 hours"
 *   label            — optional human-readable name for the job
 */

const cron     = require('node-cron');
const { ethers } = require('ethers');
const { getChainConfig, DEFAULT_CHAIN } = require('../config/constants');
const { getProvider, getWallet } = require('../utils/blockchain');
const { successResponse, errorResponse, getTxExplorerUrl } = require('../utils/helpers');
const { fireEvent } = require('../services/webhookService');
const supabase = require('../config/supabase');
const { getChainFromRequest, getChainMetadata, normalizeChainId } = require('../utils/chains');

// In-memory map of live cron tasks: jobId → cron.ScheduledTask
const activeTasks = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSupabaseConnectivityError(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return message.includes('fetch failed') || message.includes('eacces')
    || details.includes('fetch failed') || details.includes('eacces');
}

function listInMemoryScheduleJobs() {
  const jobs = [];
  activeTasks.forEach((_, id) => {
    jobs.push({
      id,
      status: 'active',
      liveStatus: 'running',
      note: 'in-memory fallback'
    });
  });
  return jobs;
}

async function purgeCompletedSuccessfulOneShotJobs() {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('scheduled_transfers')
      .delete()
      .eq('type', 'one_shot')
      .eq('status', 'completed')
      .not('last_tx_hash', 'is', null);

    if (error) {
      console.warn(`[Schedule] Failed to purge completed one-shot jobs: ${error.message}`);
    }
  } catch (cleanupError) {
    console.warn(`[Schedule] Failed to purge completed one-shot jobs: ${cleanupError.message}`);
  }
}

function isOneShot(expr) {
  // If the expression looks like an ISO datetime, treat as one-shot
  return /^\d{4}-\d{2}-\d{2}/.test(expr);
}

function isValidCron(expr) {
  return cron.validate(expr);
}

function normalizeTimeUnit(unit) {
  const normalized = String(unit || '').toLowerCase();
  if (['second', 'seconds', 'sec', 'secs'].includes(normalized)) return 'second';
  if (['minute', 'minutes', 'min', 'mins'].includes(normalized)) return 'minute';
  if (['hour', 'hours', 'hr', 'hrs'].includes(normalized)) return 'hour';
  if (['day', 'days'].includes(normalized)) return 'day';
  return null;
}

function addIntervalToNow(amount, unit) {
  const date = new Date();

  if (unit === 'second') date.setSeconds(date.getSeconds() + amount);
  if (unit === 'minute') date.setMinutes(date.getMinutes() + amount);
  if (unit === 'hour') date.setHours(date.getHours() + amount);
  if (unit === 'day') date.setDate(date.getDate() + amount);

  return date.toISOString();
}

function normalizeScheduleExpression(expr) {
  const raw = String(expr || '').trim();
  if (!raw) return { expression: raw, source: 'raw' };

  const relativeMatch = raw.match(/\b(?:in|after)\s+(\d+)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i);
  if (!relativeMatch) {
    return { expression: raw, source: 'raw' };
  }

  const amount = parseInt(relativeMatch[1], 10);
  const unit = normalizeTimeUnit(relativeMatch[2]);

  if (!Number.isFinite(amount) || amount <= 0 || !unit) {
    return { expression: raw, source: 'raw' };
  }

  return {
    expression: addIntervalToNow(amount, unit),
    source: 'relative',
    original: raw,
    amount,
    unit
  };
}

function normalizeIdentity(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLower(value) {
  return String(value || '').toLowerCase();
}

async function fetchUserWalletAddress(userId) {
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('wallet_address')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve wallet address for user ${userId}: ${error.message}`);
  }

  return data?.wallet_address || null;
}

async function userOwnsAgent(userId, agentId) {
  if (!supabase || !userId || !agentId) return false;

  const { data, error } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate agent ownership: ${error.message}`);
  }

  return Boolean(data?.id);
}

async function resolveScheduleAccessScope(req) {
  const keyRole = req.apiKey?.role || null;
  const keyAgentId = normalizeIdentity(req.apiKey?.agentId);
  const requestedUserId = normalizeIdentity(req.query?.userId || req.body?.userId);
  const requestedAgentId = normalizeIdentity(req.query?.agentId || req.body?.agentId);

  if (keyAgentId) {
    const userWalletAddress = requestedUserId ? await fetchUserWalletAddress(requestedUserId) : null;
    return { agentId: keyAgentId, userWalletAddress };
  }

  if (requestedUserId && requestedAgentId) {
    const ownsAgent = await userOwnsAgent(requestedUserId, requestedAgentId);
    if (!ownsAgent) {
      const error = new Error('Access denied for requested agent scope.');
      error.statusCode = 403;
      throw error;
    }

    const userWalletAddress = await fetchUserWalletAddress(requestedUserId);
    return { agentId: requestedAgentId, userWalletAddress };
  }

  if (requestedUserId) {
    const userWalletAddress = await fetchUserWalletAddress(requestedUserId);
    if (!userWalletAddress) {
      const error = new Error('Could not determine schedule scope from userId. Link a wallet or pass a valid agentId.');
      error.statusCode = 400;
      throw error;
    }

    return { agentId: null, userWalletAddress };
  }

  if (keyRole === 'master' && requestedAgentId) {
    return { agentId: requestedAgentId, userWalletAddress: null };
  }

  const error = new Error('Missing access scope. Provide userId (and optional agentId), or use an agent API key.');
  error.statusCode = 400;
  throw error;
}

function applyScheduleScope(query, scope) {
  const { agentId, userWalletAddress } = scope;

  if (agentId && userWalletAddress) {
    return query.or(`agent_id.eq.${agentId},wallet_address.eq.${userWalletAddress}`);
  }

  if (agentId) {
    return query.eq('agent_id', agentId);
  }

  if (userWalletAddress) {
    return query.eq('wallet_address', userWalletAddress);
  }

  return query;
}

function isJobInScope(job, scope) {
  const matchesAgent = Boolean(scope.agentId) && String(job?.agent_id || '') === String(scope.agentId);
  const matchesWallet = Boolean(scope.userWalletAddress)
    && normalizeLower(job?.wallet_address) === normalizeLower(scope.userWalletAddress);

  if (scope.agentId && scope.userWalletAddress) {
    return matchesAgent || matchesWallet;
  }

  if (scope.agentId) return matchesAgent;
  if (scope.userWalletAddress) return matchesWallet;
  return false;
}

/**
 * Execute the actual transfer for a scheduled job.
 * Writes outcome back to Supabase.
 */
async function runTransfer(job) {
  const { id, private_key, to_address, amount, token_address } = job;
  const chain = normalizeChainId(job.chain || 'arbitrum-sepolia');
  const chainConfig = getChainConfig(chain);
  const provider = getProvider(chain);
  const wallet   = getWallet(private_key, provider, chain);

  let txHash = null;
  let error  = null;

  try {
    if (!token_address) {
      // Native ETH transfer
      const amountWei = ethers.parseEther(String(amount));
      const tx = await wallet.sendTransaction({ to: to_address, value: amountWei });
      await tx.wait();
      txHash = tx.hash;
    } else {
      // ERC20 transfer
      const ERC20_ABI = [
        'function decimals() view returns (uint8)',
        'function transfer(address to, uint256 amount) returns (bool)'
      ];
      const token    = new ethers.Contract(token_address, ERC20_ABI, wallet);
      const decimals = await token.decimals().catch(() => 18);
      const amountWei = ethers.parseUnits(String(amount), decimals);
      const tx = await token.transfer(to_address, amountWei);
      await tx.wait();
      txHash = tx.hash;
    }

    console.log(`[Schedule] Job ${id} executed successfully. Tx: ${txHash}`);

    // Fire webhook as best-effort, but never fail the transfer execution because of webhook issues.
    try {
      fireEvent(job.agent_id || null, 'tx.sent', {
        type:      'scheduled_transfer',
        jobId:     id,
        txHash,
        from:      wallet.address,
        to:        to_address,
        amount,
        token:     token_address || chainConfig.nativeCurrency.symbol,
        chain
      });
    } catch (webhookError) {
      console.warn(`[Schedule] Webhook dispatch failed for job ${id}: ${webhookError.message}`);
    }
  } catch (err) {
    error = err.shortMessage || err.message;
    console.error(`[Schedule] Job ${id} failed:`, error);
  }

  // Persist execution result
  if (supabase) {
    const logEntry = {
      ran_at:   new Date().toISOString(),
      tx_hash:  txHash,
      error:    error,
      success:  !error
    };
    const updatePayload = {
      last_run_at:    new Date().toISOString(),
      last_tx_hash:   txHash,
      last_error:     error,
      run_count:      (job.run_count || 0) + 1,
      updated_at:     new Date().toISOString()
    };
    try {
      const { error: updateError } = await supabase
        .from('scheduled_transfers')
        .update(updatePayload)
        .eq('id', id);

      if (updateError) {
        console.warn(`[Schedule] Failed to update execution metadata for job ${id}: ${updateError.message}`);
      }
    } catch (persistError) {
      console.warn(`[Schedule] Failed to update execution metadata for job ${id}: ${persistError.message}`);
    }

    try {
      const { error: logError } = await supabase
        .from('scheduled_transfer_logs')
        .insert({ job_id: id, ...logEntry });

      if (logError) {
        console.warn(`[Schedule] Failed to write execution log for job ${id}: ${logError.message}`);
      }
    } catch (persistError) {
      console.warn(`[Schedule] Failed to write execution log for job ${id}: ${persistError.message}`);
    }
  }

  return { txHash, error };
}

/**
 * Register a cron task (or one-shot timer) in memory for a job row.
 */
function registerTask(job) {
  if (activeTasks.has(job.id)) {
    activeTasks.get(job.id).stop();
    activeTasks.delete(job.id);
  }

  if (job.status !== 'active') return;

  if (isOneShot(job.cron_expression)) {
    // One-shot: use setTimeout until the target datetime
    const target = new Date(job.cron_expression).getTime();
    if (!Number.isFinite(target)) {
      console.warn(`[Schedule] One-shot job ${job.id} has an invalid datetime — skipping.`);
      return;
    }
    const delay  = target - Date.now();
    if (delay <= 0) {
      console.warn(`[Schedule] One-shot job ${job.id} target is in the past — skipping.`);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await runTransfer(job);

      if (supabase) {
        if (!result?.error) {
          // Delete successful one-shot jobs so they disappear from DB/UI after execution.
          try {
            const { error: deleteError } = await supabase
              .from('scheduled_transfers')
              .delete()
              .eq('id', job.id);

            if (deleteError) {
              console.warn(`[Schedule] Failed to delete completed one-shot job ${job.id}: ${deleteError.message}`);
            }
          } catch (deletePersistError) {
            console.warn(`[Schedule] Failed to delete completed one-shot job ${job.id}: ${deletePersistError.message}`);
          }
        } else {
          // Keep failed one-shot jobs for debugging, but mark them completed to avoid reloading as active.
          try {
            const { error: completionError } = await supabase
              .from('scheduled_transfers')
              .update({ status: 'completed' })
              .eq('id', job.id);

            if (completionError) {
              console.warn(`[Schedule] Failed to mark failed one-shot job ${job.id} as completed: ${completionError.message}`);
            }
          } catch (completionPersistError) {
            console.warn(`[Schedule] Failed to mark failed one-shot job ${job.id} as completed: ${completionPersistError.message}`);
          }
        }
      }

      activeTasks.delete(job.id);
    }, delay);
    // Wrap timer in a task-like object so we can stop it
    activeTasks.set(job.id, { stop: () => clearTimeout(timer) });
  } else {
    // Recurring cron
    if (!isValidCron(job.cron_expression)) {
      console.warn(`[Schedule] Invalid cron expression for job ${job.id}: "${job.cron_expression}"`);
      return;
    }
    const task = cron.schedule(job.cron_expression, () => runTransfer(job), {
      timezone: 'UTC'
    });
    activeTasks.set(job.id, task);
  }

  console.log(`[Schedule] Registered job ${job.id} (${job.label || 'unlabeled'}) — "${job.cron_expression}"`);
}

/**
 * Load all active jobs from Supabase and re-register them.
 * Called once on server startup.
 */
async function reloadJobsFromDB() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('scheduled_transfers')
      .select('*')
      .eq('status', 'active');
    if (error) throw error;
    (data || []).forEach(registerTask);
    console.log(`[Schedule] Restored ${(data || []).length} active scheduled job(s) from DB.`);
  } catch (err) {
    console.error('[Schedule] Failed to reload jobs from DB:', err.message);
  }
}

// ── POST /schedule/transfer ────────────────────────────────────────────────────
async function createSchedule(req, res) {
  try {
    const {
      privateKey,
      toAddress,
      amount,
      tokenAddress,
      cronExpression,
      label
    } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    if (!privateKey)      return res.status(400).json(errorResponse('privateKey is required'));
    if (!toAddress)        return res.status(400).json(errorResponse('toAddress is required'));
    if (!amount)           return res.status(400).json(errorResponse('amount is required'));
    if (!cronExpression)   return res.status(400).json(errorResponse('cronExpression (cron string or ISO datetime) is required'));

    if (!ethers.isAddress(toAddress)) {
      return res.status(400).json(errorResponse('Invalid toAddress'));
    }

    const normalizedSchedule = normalizeScheduleExpression(cronExpression);
    const normalizedCronExpression = normalizedSchedule.expression;
    const oneShot = isOneShot(normalizedCronExpression);

    if (!oneShot && !isValidCron(normalizedCronExpression)) {
      return res.status(400).json(errorResponse(
        `Invalid cronExpression "${cronExpression}". Use a 5-field cron string (e.g. "0 9 * * 1"), an ISO datetime string, or a relative expression like "in 5 minutes".`
      ));
    }

    if (oneShot && Number.isNaN(new Date(normalizedCronExpression).getTime())) {
      return res.status(400).json(errorResponse('Invalid one-shot datetime. Use a valid ISO datetime string or relative expression like "in 5 minutes".'));
    }

    const requestedAgentId = normalizeIdentity(req.body?.agentId);
    const requestedUserId = normalizeIdentity(req.body?.userId);
    let agentId = req.apiKey?.agentId || null;

    if (!agentId && req.apiKey?.role === 'master' && requestedAgentId) {
      if (requestedUserId) {
        const ownsAgent = await userOwnsAgent(requestedUserId, requestedAgentId);
        if (!ownsAgent) {
          return res.status(403).json(errorResponse('Access denied for requested agent scope.'));
        }
      }
      agentId = requestedAgentId;
    }

    // Validate address
    const provider = getProvider(chain);
    const wallet = getWallet(privateKey, provider, chain);

    const jobRow = {
      agent_id:        agentId,
      private_key:     privateKey,  // stored encrypted at rest via Supabase encryption
      to_address:      toAddress,
      amount:          String(amount),
      token_address:   tokenAddress || null,
      chain,
      cron_expression: normalizedCronExpression,
      label:           label || null,
      type:            oneShot ? 'one_shot' : 'recurring',
      status:          'active',
      wallet_address:  wallet.address,
      run_count:       0,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString()
    };

    let jobId;

    if (supabase) {
      const { data, error } = await supabase
        .from('scheduled_transfers')
        .insert(jobRow)
        .select()
        .single();
      if (error) throw new Error(`DB insert failed: ${error.message}`);
      jobId = data.id;
      registerTask(data);
    } else {
      // No Supabase — run in-memory only
      jobId = `mem_${Date.now()}`;
      const memJob = { ...jobRow, id: jobId };
      registerTask(memJob);
    }

    return res.status(201).json(successResponse({
      id:              jobId,
      label:           label || null,
      type:            oneShot ? 'one_shot' : 'recurring',
      cronExpression:  normalizedCronExpression,
      requestedCronExpression: cronExpression,
      toAddress,
      amount:          `${amount} ${tokenAddress ? '(ERC20)' : chainMetadata.nativeCurrency}`,
      tokenAddress:    tokenAddress || null,
      walletAddress:   wallet.address,
      status:          'active',
      ...chainMetadata,
      note:            oneShot
        ? `Will run once at ${new Date(normalizedCronExpression).toISOString()}${normalizedSchedule.source === 'relative' ? ` (parsed from "${cronExpression}")` : ''}`
        : `Will run on schedule: "${normalizedCronExpression}" (UTC)`
    }));
  } catch (error) {
    console.error('createSchedule error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── GET /schedule ─────────────────────────────────────────────────────────────
async function listSchedules(req, res) {
  try {
    if (!supabase) {
      const jobs = listInMemoryScheduleJobs();
      return res.json(successResponse({ jobs, total: jobs.length }));
    }

    await purgeCompletedSuccessfulOneShotJobs();

    const scope = await resolveScheduleAccessScope(req);
    let query = supabase
      .from('scheduled_transfers')
      .select('id, label, type, cron_expression, to_address, amount, token_address, chain, wallet_address, status, run_count, last_run_at, last_tx_hash, last_error, created_at')
      .order('created_at', { ascending: false });

    query = applyScheduleScope(query, scope);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    // Annotate with live/paused state from in-memory map
    const jobs = (data || []).map(j => ({
      ...j,
      liveStatus: activeTasks.has(j.id) ? 'running' : (j.status === 'active' ? 'pending_reload' : j.status)
    }));

    return res.json(successResponse({ jobs, total: jobs.length }));
  } catch (error) {
    console.error('listSchedules error:', error);
    if (isSupabaseConnectivityError(error)) {
      const jobs = listInMemoryScheduleJobs();
      return res.json(successResponse({
        jobs,
        total: jobs.length,
        degraded: true,
        warning: 'Supabase unreachable; returning in-memory schedules only.'
      }));
    }

    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json(errorResponse(error.message));
  }
}

// ── GET /schedule/:id ─────────────────────────────────────────────────────────
async function getSchedule(req, res) {
  try {
    const { id } = req.params;
    if (!supabase) return res.status(503).json(errorResponse('Supabase not configured'));

    const scope = await resolveScheduleAccessScope(req);

    const { data, error } = await supabase
      .from('scheduled_transfers')
      .select('*, scheduled_transfer_logs(ran_at, tx_hash, error, success) ORDER BY scheduled_transfer_logs.ran_at DESC LIMIT 10')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json(errorResponse('Job not found'));
    if (!isJobInScope(data, scope)) {
      return res.status(403).json(errorResponse('Access denied for this schedule job.'));
    }

    return res.json(successResponse({
      ...data,
      private_key: '[redacted]',  // never expose key in response
      liveStatus: activeTasks.has(id) ? 'running' : data.status
    }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json(errorResponse(error.message));
  }
}

// ── DELETE /schedule/:id ──────────────────────────────────────────────────────
async function cancelSchedule(req, res) {
  try {
    const { id } = req.params;

    let jobRow = null;
    if (supabase) {
      const scope = await resolveScheduleAccessScope(req);

      const { data, error } = await supabase
        .from('scheduled_transfers')
        .select('id, agent_id, wallet_address, status')
        .eq('id', id)
        .single();

      if (error || !data) {
        return res.status(404).json(errorResponse('Job not found'));
      }

      if (!isJobInScope(data, scope)) {
        return res.status(403).json(errorResponse('Access denied for this schedule job.'));
      }

      jobRow = data;
    }

    // Stop in-memory task
    if (activeTasks.has(id)) {
      activeTasks.get(id).stop();
      activeTasks.delete(id);
    }

    if (supabase) {
      const { error } = await supabase
        .from('scheduled_transfers')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    }

    return res.json(successResponse({
      id,
      status: 'cancelled',
      message: 'Scheduled transfer cancelled and removed.',
      walletAddress: jobRow?.wallet_address || null
    }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json(errorResponse(error.message));
  }
}

// ── POST /schedule/:id/pause ──────────────────────────────────────────────────
async function pauseSchedule(req, res) {
  try {
    const { id } = req.params;

    if (activeTasks.has(id)) {
      activeTasks.get(id).stop();
    }

    if (supabase) {
      try {
        const { error: pauseError } = await supabase
          .from('scheduled_transfers')
          .update({ status: 'paused', updated_at: new Date().toISOString() })
          .eq('id', id);

        if (pauseError) {
          console.warn(`[Schedule] Failed to persist paused status for job ${id}: ${pauseError.message}`);
        }
      } catch (pausePersistError) {
        console.warn(`[Schedule] Failed to persist paused status for job ${id}: ${pausePersistError.message}`);
      }
    }

    return res.json(successResponse({ id, status: 'paused' }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── POST /schedule/:id/resume ─────────────────────────────────────────────────
async function resumeSchedule(req, res) {
  try {
    const { id } = req.params;
    if (!supabase) return res.status(503).json(errorResponse('Supabase not configured'));

    const { data, error } = await supabase
      .from('scheduled_transfers')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) return res.status(404).json(errorResponse('Job not found'));

    registerTask(data);

    return res.json(successResponse({ id, status: 'active', message: 'Job resumed.' }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  createSchedule,
  listSchedules,
  getSchedule,
  cancelSchedule,
  pauseSchedule,
  resumeSchedule,
  reloadJobsFromDB
};

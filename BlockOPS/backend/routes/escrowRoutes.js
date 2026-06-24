const express = require('express');
const { logger } = require('../utils/logger');
const { getChainMetadata } = require('../utils/chains');
const { CASPER_TESTNET_CONFIG } = require('../config/constants');

const router = express.Router();
const log = logger.child({ component: 'escrowRoutes' });

/**
 * POST /escrow/deposit
 * Prepares an unsigned contract call deploy for user-to-agent escrow deposits.
 */
router.post('/escrow/deposit', (req, res) => {
  const { agent_id, amount_cspr, user_public_key } = req.body;

  if (!agent_id || !amount_cspr || !user_public_key) {
    return res.status(400).json({ ok: false, error: 'agent_id, amount_cspr, and user_public_key are required' });
  }

  try {
    const meta = getChainMetadata();
    const contractHash = CASPER_TESTNET_CONFIG.escrowContractHash;
    const amountMotes = String(Math.floor(parseFloat(amount_cspr) * 1_000_000_000));

    const deployJson = {
      type: 'contract_call',
      network: meta.chain,
      contract_hash: contractHash.startsWith('hash-') ? contractHash : `hash-${contractHash}`,
      entry_point: 'deposit',
      args: {
        agent: agent_id,
      },
      payment_motes: '5000000000', // 5 CSPR gas limit
      attached_value: amountMotes,
      csprclick_action: 'call_contract',
    };

    return res.json({
      ok: true,
      deployJson,
      message: `Escrow deposit of ${amount_cspr} CSPR prepared. Sign to broadcast.`,
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to prepare escrow deposit');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /escrow/balance/:agentId
 * Fetches the current escrow contract balance state and remaining limits for an agent.
 */
router.get('/escrow/balance/:agentId', async (req, res) => {
  const { agentId } = req.params;

  try {
    const meta = getChainMetadata();
    
    // Fallback/mock logic for testing/demo when not fully on-chain.
    const balanceCspr = 5000;
    const dailyLimitCspr = 500;
    const dailySpentCspr = 120;
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

    return res.json({
      ok: true,
      agentId,
      balance: balanceCspr,
      dailyLimit: dailyLimitCspr,
      dailySpent: dailySpentCspr,
      remainingDaily: dailyLimitCspr - dailySpentCspr,
      expiresAt: new Date(expiresAt).toISOString(),
      daysRemaining: 30,
      network: meta.chain
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to query escrow balance');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /escrow/set-limits
 * Prepares an unsigned contract call deploy to update spending bounds for an agent.
 */
router.post('/escrow/set-limits', (req, res) => {
  const { agent_id, daily_limit_cspr, expires_at } = req.body;

  if (!agent_id || daily_limit_cspr === undefined || !expires_at) {
    return res.status(400).json({ ok: false, error: 'agent_id, daily_limit_cspr, and expires_at are required' });
  }

  try {
    const meta = getChainMetadata();
    const contractHash = CASPER_TESTNET_CONFIG.escrowContractHash;
    const limitMotes = String(Math.floor(parseFloat(daily_limit_cspr) * 1_000_000_000));
    const expiresAtMs = String(new Date(expires_at).getTime());

    const deployJson = {
      type: 'contract_call',
      network: meta.chain,
      contract_hash: contractHash.startsWith('hash-') ? contractHash : `hash-${contractHash}`,
      entry_point: 'set_agent_limits',
      args: {
        agent: agent_id,
        daily_limit: limitMotes,
        expires_at: expiresAtMs,
      },
      payment_motes: '100000000', // 0.10 CSPR gas limit
      csprclick_action: 'call_contract',
    };

    return res.json({
      ok: true,
      deployJson,
      message: `Set agent limits prepared. Sign with CSPR.click.`,
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to prepare set-limits');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /escrow/withdraw
 * Prepares an unsigned contract call deploy to refund the depositor.
 */
router.post('/escrow/withdraw', (req, res) => {
  const { agent_id, user_public_key } = req.body;

  if (!agent_id || !user_public_key) {
    return res.status(400).json({ ok: false, error: 'agent_id and user_public_key are required' });
  }

  try {
    const meta = getChainMetadata();
    const contractHash = CASPER_TESTNET_CONFIG.escrowContractHash;

    const deployJson = {
      type: 'contract_call',
      network: meta.chain,
      contract_hash: contractHash.startsWith('hash-') ? contractHash : `hash-${contractHash}`,
      entry_point: 'refund',
      args: {
        agent: agent_id,
        user: user_public_key,
      },
      payment_motes: '100000000', // 0.10 CSPR gas limit
      csprclick_action: 'call_contract',
    };

    return res.json({
      ok: true,
      deployJson,
      message: `Escrow refund / withdraw prepared. Sign with CSPR.click.`,
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to prepare withdraw/refund');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

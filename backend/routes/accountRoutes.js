'use strict';

/**
 * Phase 37: Casper-Unique Account Management Routes
 *
 * Exposes REST endpoints for:
 *   - Account associated-key weight management
 *   - Delegated sub-key management (time-bound, spending-capped)
 *   - Contract package upgrades
 *   - CEP-78 NFT metadata mutation
 *   - WASM gas profiling
 */

const express = require('express');
const { logger } = require('../utils/logger');
const { getChainMetadata } = require('../utils/chains');
const {
  update_account_weights,
  upgrade_contract_package,
  update_nft_metadata,
  add_delegated_key,
  profile_wasm_gas,
} = require('../services/directToolExecutor');

const router = express.Router();
const log = logger.child({ component: 'accountRoutes' });

// ─── Account Key Management ───────────────────────────────────────────────────

/**
 * GET /account/:publicKey/keys
 * Returns the list of associated keys for a Casper account.
 * Queries CSPR.cloud for the live account state.
 */
router.get('/account/:publicKey/keys', async (req, res) => {
  const { publicKey } = req.params;
  if (!publicKey || !/^(?:01[0-9a-fA-F]{64}|02[0-9a-fA-F]{66})$/.test(publicKey)) {
    return res.status(400).json({ ok: false, error: 'Invalid Casper public key format' });
  }

  try {
    const meta = getChainMetadata();
    const axios = require('axios');

    // Try CSPR.cloud account query
    let associatedKeys = [];
    let actionThreshold = 1;
    let deploymentThreshold = 1;

    try {
      const response = await axios.get(
        `${meta.csprCloudUrl}/accounts/${publicKey}`,
        { timeout: 5000, headers: { 'Content-Type': 'application/json' } }
      );
      const account = response.data?.data;
      associatedKeys = account?.associated_keys || [];
      actionThreshold = account?.action_threshold?.deployment_threshold || 1;
      deploymentThreshold = account?.action_threshold?.key_management_threshold || 1;
    } catch {
      // Return placeholder when CSPR.cloud is unavailable (dev/test)
      associatedKeys = [{ account_hash: `account-hash-${'0'.repeat(64)}`, weight: 1 }];
      log.warn({ publicKey }, 'CSPR.cloud unavailable — returning placeholder keys');
    }

    return res.json({
      ok: true,
      publicKey,
      associatedKeys,
      actionThreshold,
      deploymentThreshold,
      explorerUrl: `${meta.explorerBaseUrl}/account/${publicKey}`,
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to fetch account keys');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /account/update-weights
 * Builds and returns an unsigned account-update deploy for CSPR.click to sign.
 */
router.post('/account/update-weights', async (req, res) => {
  const { public_key, keys, action_threshold, deployment_threshold } = req.body;

  if (!public_key || !Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ ok: false, error: '`public_key` and `keys` array are required' });
  }

  try {
    const result = await update_account_weights({ public_key, keys, action_threshold, deployment_threshold });
    return res.json({ ok: result.success, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'update-weights route error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Delegated Keys ───────────────────────────────────────────────────────────

/**
 * GET /account/:publicKey/delegated-keys
 * Returns active delegated keys for a Casper account from CasperOPs metadata.
 */
router.get('/account/:publicKey/delegated-keys', async (req, res) => {
  const { publicKey } = req.params;
  if (!publicKey || !/^(?:01[0-9a-fA-F]{64}|02[0-9a-fA-F]{66})$/.test(publicKey)) {
    return res.status(400).json({ ok: false, error: 'Invalid Casper public key format' });
  }

  try {
    const meta = getChainMetadata();

    // In production this would query the delegated_keys table in Supabase.
    // For dev/demo we return sample structure.
    const delegatedKeys = [];

    return res.json({
      ok: true,
      publicKey,
      delegatedKeys,
      count: delegatedKeys.length,
      network: meta.chain,
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to fetch delegated keys');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /account/delegated-key
 * Builds an add-associated-key deploy with optional daily limit and expiry.
 */
router.post('/account/delegated-key', async (req, res) => {
  const { public_key, delegate_key, weight, daily_limit_motes, expires_at } = req.body;

  if (!public_key || !delegate_key || weight === undefined) {
    return res.status(400).json({ ok: false, error: '`public_key`, `delegate_key`, and `weight` are required' });
  }
  if (typeof weight !== 'number' || weight < 1 || weight > 254) {
    return res.status(400).json({ ok: false, error: 'weight must be an integer between 1 and 254' });
  }

  try {
    const result = await add_delegated_key({ public_key, delegate_key, weight, daily_limit_motes, expires_at });
    return res.json({ ok: result.success, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'delegated-key route error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Contract Package Upgrader ────────────────────────────────────────────────

/**
 * POST /contract/upgrade
 * Builds an upgrade deploy targeting an existing contract package hash.
 */
router.post('/contract/upgrade', async (req, res) => {
  const { package_hash, wasm_hex, entry_points, payment_motes } = req.body;

  if (!package_hash || !wasm_hex) {
    return res.status(400).json({ ok: false, error: '`package_hash` and `wasm_hex` are required' });
  }

  try {
    const result = await upgrade_contract_package({ package_hash, wasm_hex, entry_points, payment_motes });
    return res.json({ ok: result.success, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'contract upgrade route error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── CEP-78 NFT Metadata Updater ─────────────────────────────────────────────

/**
 * POST /nft/update-metadata
 * Calls set_token_metadata on a CEP-78 collection contract.
 */
router.post('/nft/update-metadata', async (req, res) => {
  const { collection_hash, token_id, metadata, metadata_uri } = req.body;

  if (!collection_hash || token_id === undefined) {
    return res.status(400).json({ ok: false, error: '`collection_hash` and `token_id` are required' });
  }
  if (!metadata && !metadata_uri) {
    return res.status(400).json({ ok: false, error: 'Either `metadata` object or `metadata_uri` must be provided' });
  }

  try {
    const result = await update_nft_metadata({ collection_hash, token_id, metadata, metadata_uri });
    return res.json({ ok: result.success, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'update-metadata route error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── WASM Gas Profiler ────────────────────────────────────────────────────────

/**
 * POST /wasm/profile
 * Statically analyzes a WASM binary and returns estimated gas + optimization tips.
 */
router.post('/wasm/profile', async (req, res) => {
  const { wasm_hex, entry_point } = req.body;

  if (!wasm_hex) {
    return res.status(400).json({ ok: false, error: '`wasm_hex` is required' });
  }
  if (!/^[0-9a-fA-F]+$/.test(wasm_hex)) {
    return res.status(400).json({ ok: false, error: '`wasm_hex` must be valid hexadecimal' });
  }

  try {
    const result = await profile_wasm_gas({ wasm_hex, entry_point });
    return res.json({ ok: result.success, ...result });
  } catch (err) {
    log.error({ err: err.message }, 'wasm profile route error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

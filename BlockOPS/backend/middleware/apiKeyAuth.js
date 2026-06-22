/**
 * API Key Authentication Middleware
 *
 * Validates the `x-api-key` header on protected routes.
 * Two valid key sources:
 *   1. MASTER_API_KEY env var — full access (admin / local dev)
 *   2. Per-agent key stored in Supabase `agent_api_keys` table
 *
 * On success attaches `req.apiKey` = { agentId, userId, keyId }
 * On failure returns 401 (missing) or 403 (invalid / inactive)
 */

const supabase = require('../config/supabase');
require('dotenv').config();

const MASTER_API_KEY = process.env.MASTER_API_KEY || null;

/**
 * Hash a raw key with SHA-256 so we never store/compare plaintext in DB.
 * Uses Node's built-in crypto — no extra dependency.
 */
function hashKey(raw) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Middleware factory.
 * @param {Object} options
 * @param {boolean} options.optional - If true, skip auth but still attach key info if present
 */
function apiKeyAuth(options = {}) {
  const { optional = false } = options;

  return async function (req, res, next) {
    const rawKey = req.headers['x-api-key'];

    // No key provided
    if (!rawKey) {
      if (optional) return next();
      return res.status(401).json({
        success: false,
        error: 'Missing API key. Pass your key in the x-api-key header.'
      });
    }

    // 1. Check master key (env-based, no DB hit)
    if (MASTER_API_KEY && rawKey === MASTER_API_KEY) {
      req.apiKey = { agentId: null, userId: null, keyId: 'master', role: 'master' };
      return next();
    }

    // 2. Check per-agent key in Supabase
    if (!supabase) {
      // Supabase not configured — only master key allowed
      return res.status(403).json({
        success: false,
        error: 'Invalid API key.'
      });
    }

    try {
      const hashed = hashKey(rawKey);

      const { data, error } = await supabase
        .from('agent_api_keys')
        .select('id, agent_id, user_id, is_active, last_used_at')
        .eq('key_hash', hashed)
        .single();

      if (error || !data) {
        return res.status(403).json({
          success: false,
          error: 'Invalid API key.'
        });
      }

      if (!data.is_active) {
        return res.status(403).json({
          success: false,
          error: 'API key has been revoked.'
        });
      }

      // Attach info to request
      req.apiKey = {
        keyId: data.id,
        agentId: data.agent_id,
        userId: data.user_id,
        role: 'agent'
      };

      // Fire-and-forget: update last_used_at
      supabase
        .from('agent_api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => {})
        .catch(() => {});

      return next();
    } catch (err) {
      console.error('API key auth error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Authentication service error. Please try again.'
      });
    }
  };
}

module.exports = apiKeyAuth;

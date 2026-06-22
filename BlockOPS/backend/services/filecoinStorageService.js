/**
 * BlockOps no-op shim for the deprecated Filecoin storage service.
 *
 * Filecoin archival was removed when BlockOps migrated off EVM/RWA
 * (Phase 13). This module preserves the import-time contract so the rest
 * of the codebase keeps working — it just returns safe no-op responses.
 *
 * Real persistence now lives in Supabase (`deploy_history`, `tool_executions`,
 * `reputation_events` — see supabase/migrations/20260622_casper_schema.sql).
 */

async function archiveJsonToFilecoin(_payload, _opts = {}) {
  return {
    status: 'disabled',
    cid: null,
    pieceCid: null,
    uri: null,
    provider: null,
    prepareTxHash: null,
    error: 'filecoin archival removed in Casper migration; see supabase.tool_executions',
  }
}

async function retrieveJsonFromFilecoin(_opts = {}) {
  return {
    status: 'disabled',
    data: null,
    error: 'filecoin retrieval removed in Casper migration; see supabase.tool_executions',
  }
}

function parsePieceCidFromUri(_uri) {
  return null
}

module.exports = {
  archiveJsonToFilecoin,
  retrieveJsonFromFilecoin,
  parsePieceCidFromUri,
}

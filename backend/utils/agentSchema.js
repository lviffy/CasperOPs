const AGENT_LIST_SELECT = 'id, user_id, name, description, api_key, tools, status, system_prompt, enabled_tools, wallet_address, on_chain_id, api_key_prefix, is_public, created_at, updated_at';
const AGENT_LIST_SELECT_LEGACY = AGENT_LIST_SELECT.replace('on_chain_id, ', '');
const AGENT_REGISTRATION_SELECT = 'user_id, on_chain_id, name, description, enabled_tools, wallet_address, avatar_url, is_public';
const AGENT_REGISTRATION_SELECT_LEGACY = AGENT_REGISTRATION_SELECT.replace('on_chain_id, ', '');
const ON_CHAIN_ID_MIGRATION_MESSAGE = 'The agents table is missing the on_chain_id column. Run backend/database/migrations/003_complete_agents_schema.sql (or add the column manually) before using on-chain agent registration.';

function isMissingOnChainIdColumnError(error) {
  if (!error) return false;

  const details = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return details.includes('on_chain_id') && details.includes('does not exist');
}

function getOnChainIdColumnMigrationMessage() {
  return ON_CHAIN_ID_MIGRATION_MESSAGE;
}

module.exports = {
  AGENT_LIST_SELECT,
  AGENT_LIST_SELECT_LEGACY,
  AGENT_REGISTRATION_SELECT,
  AGENT_REGISTRATION_SELECT_LEGACY,
  isMissingOnChainIdColumnError,
  getOnChainIdColumnMigrationMessage,
};

-- Migration: Remove Filecoin and Lit Protocol Columns
-- Drops remaining columns associated with Filecoin and Lit Protocol.

ALTER TABLE agent_registry DROP COLUMN IF EXISTS metadata_cid;
ALTER TABLE agent_registry DROP COLUMN IF EXISTS metadata_uri;

ALTER TABLE agent_tool_execution_logs DROP COLUMN IF EXISTS filecoin_cid;
ALTER TABLE agent_tool_execution_logs DROP COLUMN IF EXISTS filecoin_uri;
ALTER TABLE agent_tool_execution_logs DROP COLUMN IF EXISTS filecoin_provider;
ALTER TABLE agent_tool_execution_logs DROP COLUMN IF EXISTS storage_status;
ALTER TABLE agent_tool_execution_logs DROP COLUMN IF EXISTS storage_error;

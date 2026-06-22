# Filecoin Audit Logging Setup

BlockOps uses Filecoin Calibration and Synapse SDK to store immutable tool execution logs. Every audited tool run can produce a Filecoin-backed JSON record plus a matching row in Supabase for fast lookup inside the product.

## What We Implemented

- Filecoin archival through `@filoz/synapse-sdk`.
- Per-tool audit records generated after chat-driven execution.
- Sanitization of request parameters and result payloads before storage.
- Supabase-backed indexing for registry discovery and log lookup.
- Retrieval endpoints that return the exact archived JSON envelope.

## Main Files

- `backend/services/filecoinStorageService.js`
- `backend/services/toolAuditLogService.js`
- `backend/controllers/conversationController.js`
- `backend/controllers/agentRegistryController.js`
- `backend/routes/agentRoutes.js`
- `backend/database/migrations/003_agent_registry_and_filecoin_audit.sql`

## Required Environment Variables

Add these to `backend/.env`:

```bash
FILECOIN_WALLET_PRIVATE_KEY=your_calibration_private_key
SYNAPSE_SOURCE=blockops-agent-audit
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
```

Optional settings:

```bash
SYNAPSE_WITH_CDN=false
FILECOIN_PREPARE_BUFFER_BYTES=4096
FILECOIN_AUDIT_WAIT_MS=8000
```

Notes:

- `FILECOIN_WALLET_PRIVATE_KEY` is used to sign `prepare()` transactions when Synapse requires them.
- `SYNAPSE_SOURCE` is written into the archive metadata.
- Supabase is required for the local index tables even though the full payload is stored on Filecoin.

## Network and Storage Model

BlockOps uses:

- Filecoin Calibration for storage settlement and retrieval
- Synapse SDK for `prepare()` and `upload()`
- PieceCID as the canonical Filecoin content identifier

The storage flow is:

`prepare() -> execute funding tx if needed -> upload() -> store PieceCID + URI in Supabase`

## Database Setup

Run this migration in Supabase:

- `backend/database/migrations/003_agent_registry_and_filecoin_audit.sql`

Tables created by that migration:

- `agent_registry`
- `agent_tool_execution_logs`

## What Gets Stored

Each audited tool execution records:

- `agent_id`
- `user_id`
- `conversation_id`
- `tool_name`
- `chain`
- sanitized input parameters
- summarized result payload
- success or failure status
- transaction hash when available
- `filecoin_cid`
- `filecoin_uri`
- storage status and any storage error

The archived Filecoin payload is wrapped in a standard JSON envelope with:

- `schemaVersion`
- `payload`
- `metadata`
- `name`
- `namespace`
- `timestamp`

## Runtime Flow

1. A user sends a message through the chat UI.
2. `/api/chat` routes the request through the backend runtime.
3. Tool execution results are collected in `conversationController.js`.
4. `toolAuditLogService.js` sanitizes parameters and results.
5. `filecoinStorageService.js` prepares and uploads the JSON payload to Filecoin Calibration.
6. The backend stores the resulting PieceCID and storage metadata in `agent_tool_execution_logs`.
7. The chat response includes a compact execution audit summary.

## API Endpoints

Registry endpoints:

- `GET /agents/registry/discover`
- `PUT /agents/:id/registry`
- `GET /agents/:id/registry`

Audit endpoints:

- `GET /agents/:id/audit-logs`
- `GET /agents/:id/audit-logs/:logId/content`

The `/content` endpoint returns the exact archived envelope together with convenience fields for `payload`, `metadata`, and `rawText`.

## How to Set It Up

1. Fund a Filecoin Calibration wallet with `tFIL` and `tUSDFC`.
2. Add the Filecoin and Supabase values to `backend/.env`.
3. Run `backend/database/migrations/003_agent_registry_and_filecoin_audit.sql`.
4. Start the backend.
5. Trigger a tool execution from chat or through an agent route.
6. Open the audit logs UI or query the audit endpoints.

## How to Verify It

1. Run a chat request that executes at least one tool.
2. Confirm the response includes a tool execution log summary.
3. Check Supabase and verify that the row contains:
   - `storage_status = stored` or `pending`
   - `filecoin_cid`
   - `filecoin_uri`
4. Call `GET /agents/:id/audit-logs/:logId/content` to retrieve the archived JSON.
5. Confirm the returned `payload` matches the tool execution that just ran.

## Why Filecoin Matters Here

Filecoin gives BlockOps a durable audit layer for autonomous agents:

- tool activity is preserved outside the app database
- audit records are portable and inspectable
- judges can verify that execution logs are not just UI-only artifacts
- the same archive flow supports both agent registry metadata and execution history

/**
 * Zod-based input validation middleware for the 22 BlockOps tools.
 *
 * Each tool has a zod schema. The middleware:
 *   1. Coerces query / path / body params into the schema.
 *   2. Strips unknown fields (so an attacker can't sneak in extra args).
 *   3. Returns 400 with a detailed error message on failure.
 *
 * Usage in app.js:
 *   const { validateToolRequest } = require('./middleware/validate');
 *   app.post('/v1/tools/:toolId', validateToolRequest(), toolHandler);
 */

const { z } = require('zod')
const { logger } = require('../utils/logger')

const publicKeySchema = z
  .string()
  .regex(/^0[12][0-9a-fA-F]{64}$/, 'public key must be 0x/01/02-prefixed 64-char hex')
const hashSchema = z.string().regex(/^hash-[0-9a-fA-F]{64}$/, 'must be hash-<64hex>')
const motesSchema = z.string().regex(/^[0-9]+$/, 'amount must be an integer in motes')

const schemas = {
  get_balance: z.object({ public_key: publicKeySchema }),
  transfer: z.object({
    recipient: publicKeySchema,
    amount_motes: motesSchema,
    memo: z.string().max(256).optional(),
  }),
  batch_transfer: z.object({
    transfers: z
      .array(
        z.object({
          recipient: publicKeySchema,
          amount_motes: motesSchema,
        }),
      )
      .min(1)
      .max(25),
  }),
  deploy_cep18: z.object({
    name: z.string().min(1).max(64),
    symbol: z.string().min(1).max(16),
    decimals: z.number().int().min(0).max(18),
    total_supply: z.string().regex(/^[0-9]+$/),
  }),
  deploy_cep78: z.object({
    name: z.string().min(1).max(64),
    symbol: z.string().min(1).max(16),
    total_supply: z.number().int().min(1).max(1_000_000),
  }),
  mint_nft: z.object({
    collection_hash: hashSchema,
    recipient: publicKeySchema,
    metadata_uri: z.string().max(512).optional(),
  }),
  get_token_info: z.object({ contract_hash: hashSchema }),
  get_token_balance: z.object({ contract_hash: hashSchema, public_key: publicKeySchema }),
  get_nft_info: z.object({ collection_hash: hashSchema, token_id: z.string() }),
  lookup_deploy: z.object({ deploy_hash: z.string().regex(/^[0-9a-fA-F]{64,}$/) }),
  lookup_block: z.object({ block_identifier: z.union([z.string(), z.object({}).passthrough()]) }),
  fetch_price: z.object({}).optional(),
  send_email: z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(256),
    body: z.string().min(1).max(10_000),
  }),
  calculate: z.object({ expression: z.string().min(1).max(512) }),
  register_agent: z.object({
    agent_id: z.string().min(1).max(128),
    metadata_uri: z.string().max(512).optional(),
  }),
  attest_agent: z.object({
    agent_id: z.string().min(1).max(128),
    score: z.number().int().min(0).max(100),
    evidence_uri: z.string().max(512).optional(),
  }),
  get_reputation: z.object({ agent_id: z.string().min(1).max(128) }),
  yield_rebalance: z.object({
    allocations: z
      .array(
        z.object({
          validator: z.string().min(1).max(128),
          weight_bps: z.number().int().min(0).max(10_000),
        }),
      )
      .min(1)
      .max(20)
      .refine(
        (allocs) => allocs.reduce((s, a) => s + a.weight_bps, 0) === 10_000,
        { message: 'weight_bps must sum to 10_000 (100%)' },
      ),
  }),
  wallet_readiness: z.object({ public_key: publicKeySchema }),
  compliance_check: z.object({
    agent_id: z.string().min(1).max(128),
    jurisdiction: z.string().min(2).max(8).optional(),
  }),
  escrow_deposit: z.object({
    agent_id: z.string().min(1).max(128),
    amount_motes: motesSchema,
  }),
  escrow_payout: z.object({ agent_id: z.string().min(1).max(128) }),
}

function validateToolRequest() {
  return function validateToolRequestMiddleware(req, res, next) {
    const toolId = req.params?.toolId || req.body?.tool || req.body?.toolId
    if (!toolId) {
      return res.status(400).json({ error: "Missing 'tool' / 'toolId' field" })
    }
    const schema = schemas[toolId]
    if (!schema) {
      return res.status(400).json({ error: `Unknown tool: ${toolId}` })
    }

    // Build a single input from body / query / params, in that order.
    const input = { ...(req.query || {}), ...(req.params || {}), ...(req.body || {}) }
    delete input.tool
    delete input.toolId

    const result = schema.safeParse(input)
    if (!result.success) {
      logger.warn({ toolId, errors: result.error.issues }, 'tool input validation failed')
      return res.status(400).json({
        error: 'Invalid tool input',
        toolId,
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      })
    }

    req.validated = { toolId, params: result.data }
    next()
  }
}

module.exports = { validateToolRequest, schemas }

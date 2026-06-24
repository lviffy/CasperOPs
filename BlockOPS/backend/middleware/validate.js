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
  rwa_valuation: z.object({
    propertyAddress: z.string().min(3).max(512).optional(),
    property_address: z.string().min(3).max(512).optional(),
  }).refine(data => data.propertyAddress || data.property_address, {
    message: "Either propertyAddress or property_address must be provided"
  }).transform(data => ({
    propertyAddress: data.propertyAddress || data.property_address
  })),
  fractionalize_rwa: z.object({
    propertyAddress: z.string().min(3).max(512).optional(),
    property_address: z.string().min(3).max(512).optional(),
    valuationId: z.string().min(1).max(128).optional(),
    valuation_id: z.string().min(1).max(128).optional(),
    tokenName: z.string().min(1).max(64).optional(),
    token_name: z.string().min(1).max(64).optional(),
    tokenSymbol: z.string().min(1).max(16).optional(),
    token_symbol: z.string().min(1).max(16).optional(),
    decimals: z.number().int().min(0).max(18).optional(),
    fractionsCount: z.number().int().min(1).optional(),
    fractions_count: z.number().int().min(1).optional(),
    totalShares: z.number().int().min(1).optional(),
    total_shares: z.number().int().min(1).optional(),
  }).refine(data => (data.propertyAddress || data.property_address) && (data.valuationId || data.valuation_id), {
    message: "propertyAddress (or property_address) and valuationId (or valuation_id) must be provided"
  }).transform(data => ({
    propertyAddress: data.propertyAddress || data.property_address,
    valuationId: data.valuationId || data.valuation_id,
    tokenName: data.tokenName || data.token_name || "Fractional RWA Share",
    tokenSymbol: data.tokenSymbol || data.token_symbol || "FRWA",
    decimals: data.decimals !== undefined ? data.decimals : 9,
    fractionsCount: data.fractionsCount || data.fractions_count || data.totalShares || data.total_shares || 10_000,
  })),
  attest_performance: z.object({
    agentAddress: publicKeySchema.optional(),
    agent_address: publicKeySchema.optional(),
    success: z.boolean().optional(),
  }).refine(data => (data.agentAddress || data.agent_address) && data.success !== undefined, {
    message: "agentAddress (or agent_address) and success (boolean) must be provided"
  }).transform(data => ({
    agentAddress: data.agentAddress || data.agent_address,
    success: data.success,
  })),
  post_message: z.object({
    topic: z.string().min(1).max(128),
    message: z.string().min(1).max(1024),
  }),
  get_message: z.object({
    topic: z.string().min(1).max(128),
  }),
  // Phase 37: Casper-unique native capabilities
  update_account_weights: z.object({
    public_key: publicKeySchema,
    keys: z
      .array(
        z.object({
          account_hash: z
            .string()
            .regex(/^account-hash-[0-9a-fA-F]{64}$|^0[12][0-9a-fA-F]{64}$/, 'must be account-hash or public key'),
          weight: z.number().int().min(1).max(255),
        }),
      )
      .min(1)
      .max(10),
    action_threshold: z.number().int().min(1).max(255).optional(),
    deployment_threshold: z.number().int().min(1).max(255).optional(),
  }),
  upgrade_contract_package: z.object({
    package_hash: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$|^hash-[0-9a-fA-F]{64}$/, 'must be a 64-char hex or hash-<hex> package hash'),
    wasm_hex: z.string().regex(/^[0-9a-fA-F]+$/, 'wasm_hex must be valid hex').min(8),
    entry_points: z.array(z.string()).max(20).optional(),
    payment_motes: z.string().regex(/^[0-9]+$/).optional(),
  }),
  update_nft_metadata: z.object({
    collection_hash: hashSchema,
    token_id: z.union([z.string(), z.number()]).transform(String),
    metadata: z.record(z.string(), z.string()).refine(
      (m) => Object.keys(m).length <= 20,
      { message: 'metadata may not exceed 20 key-value pairs' },
    ).optional(),
    metadata_uri: z.string().url().optional(),
  }).refine(
    (d) => d.metadata || d.metadata_uri,
    { message: 'Either metadata object or metadata_uri must be provided' },
  ),
  add_delegated_key: z.object({
    public_key: publicKeySchema,
    delegate_key: publicKeySchema,
    weight: z.number().int().min(1).max(254),
    daily_limit_motes: z.string().regex(/^[0-9]+$/).optional(),
    expires_at: z.string().datetime({ offset: true }).optional(),
  }),
  profile_wasm_gas: z.object({
    wasm_hex: z.string().regex(/^[0-9a-fA-F]+$/, 'wasm_hex must be valid hex').min(8),
    entry_point: z.string().min(1).max(64).optional(),
  }),
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

/**
 * Environment-variable validation middleware.
 *
 * Fails fast at boot when a required variable is missing or malformed.
 * In `NODE_ENV=production` every documented secret must be present; in
 * `development` we accept the defaults the rest of the codebase already
 * relies on (testnet RPC, dummy contract hashes, etc.) so contributors can
 * run `./scripts/dev.sh up` without a `.env` file.
 *
 * The `validateEnv()` function:
 *   1. Parses `process.env` against a Zod schema.
 *   2. On success, returns the parsed object so callers can attach it to
 *      their config.
 *   3. On failure, prints every missing/invalid variable grouped by section
 *      and exits with code 1 — so Docker / Fly / Render mark the deploy as
 *      failed instead of booting a broken service.
 *
 * Schemas are intentionally explicit so the diff on a "we need a new env
 * var" PR is visible and reviewable.
 */

const { z } = require('zod');

// Note: we deliberately do NOT capture `NODE_ENV` at module load. The
// schema is rebuilt on every `validateEnv()` call so test suites that
// toggle `process.env.NODE_ENV` between cases get the production-mode
// schema on demand.

// Trimming helper so accidental trailing newlines in Docker secrets don't
// cause `CASPER_SECRET_KEY` to look 64 chars but actually be 65.
const trim = (val) => (typeof val === 'string' ? val.trim() : val);

const casperKeySchema = z.preprocess(
  trim,
  z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, 'must be 64-char hex (optional 0x prefix)'),
);

function buildSchema(isProd) {
  return z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Casper
    CASPER_RPC_URL: z.string().url().default('https://rpc.testnet.casper.live/rpc'),
    CSPR_CLOUD_API_URL: z.string().url().default('https://api.testnet.cspr.cloud'),
    CSPR_CLOUD_API_KEY: z.preprocess(trim, z.string().optional()),
    CASPER_CHAIN_NAME: z.string().min(1).default('casper-test'),
    CASPER_SECRET_KEY: isProd
      ? casperKeySchema
      : z.preprocess(trim, z.string().optional()),
    CASPER_AGENT_FACTORY_HASH: z.preprocess(trim, z.string().min(1).optional()),
    CASPER_REPUTATION_HASH: z.preprocess(trim, z.string().min(1).optional()),
    CASPER_ESCROW_HASH: z.preprocess(trim, z.string().min(1).optional()),
    CASPER_COMPLIANCE_HASH: z.preprocess(trim, z.string().min(1).optional()),
    CASPER_MESSAGE_BOARD_HASH: z.preprocess(trim, z.string().min(1).optional()),

    // AI
    GROQ_API_KEY1: z.preprocess(
      trim,
      isProd ? z.string().min(10) : z.string().optional(),
    ),
    GROQ_API_KEY2: z.preprocess(trim, z.string().optional()),
    GROQ_API_KEY3: z.preprocess(trim, z.string().optional()),
    GEMINI_API_KEY: z.preprocess(trim, z.string().optional()),
    OPENAI_API_KEY: z.preprocess(trim, z.string().optional()),

    // Supabase
    SUPABASE_URL: z.preprocess(
      trim,
      isProd ? z.string().url() : z.string().url().optional(),
    ),
    SUPABASE_SERVICE_KEY: z.preprocess(
      trim,
      isProd ? z.string().min(20) : z.string().optional(),
    ),

    // Admin
    ADMIN_SECRET: z.preprocess(
      trim,
      isProd ? z.string().min(16) : z.string().optional(),
    ),
    MASTER_API_KEY: z.preprocess(
      trim,
      isProd ? z.string().min(16) : z.string().optional(),
    ),
    SERVER_SIGNER_PRIVATE_KEY: z.preprocess(trim, z.string().optional()),

    // Notifications
    GMAIL_USER: z.preprocess(trim, z.string().optional()),
    GMAIL_APP_PASSWORD: z.preprocess(trim, z.string().optional()),
    TELEGRAM_BOT_TOKEN: z.preprocess(trim, z.string().optional()),
    TELEGRAM_WEBHOOK_URL: z.preprocess(trim, z.string().optional()),

    // Agent backend
    AGENT_BACKEND_URL: z.preprocess(trim, z.string().url().default('http://localhost:8000')),

    // Cache / observability
    REDIS_URL: z.preprocess(trim, z.string().optional()),
    SENTRY_DSN: z.preprocess(trim, z.string().optional()),
    SENTRY_ENV: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  });
}

// Back-compat: expose a schema built for the current NODE_ENV at import time
// so callers can use `envSchema.safeParse(...)` directly. Production-mode
// validation in tests should use `validateEnv()` instead.
const envSchema = buildSchema(process.env.NODE_ENV === 'production');

// ── Pretty printer ────────────────────────────────────────────────────────

function formatIssues(error) {
  const lines = [];
  for (const issue of error.issues) {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    lines.push(`  - ${path}: ${issue.message}`);
  }
  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────

let cached = null;
let cachedKey = null;

function validateEnv({ exitOnError = true, logger = console, strict = null } = {}) {
  // Re-read NODE_ENV every call so test suites that toggle it get the right
  // schema on demand. In production the boot script sets NODE_ENV=production
  // before requiring app.js, so the second call (process restart) is fine.
  const envValue = process.env.NODE_ENV || 'development';
  const isProd = strict === true || (strict === null && envValue === 'production');
  const cacheKey = `${envValue}|${isProd ? 1 : 0}`;

  if (cached && cachedKey === cacheKey) return cached;

  const schema = buildSchema(isProd);
  const parsed = schema.safeParse(process.env);
  if (parsed.success) {
    cached = parsed.data;
    cachedKey = cacheKey;
    logger.info?.(
      `[validateEnv] ok (mode=${parsed.data.NODE_ENV}, port=${parsed.data.PORT})`,
    );
    return cached;
  }

  const banner = '='.repeat(72);
  logger.error?.(`\n${banner}\n  CasperOPs backend boot aborted — invalid environment\n${banner}`);
  logger.error?.(`\nIssues:\n${formatIssues(parsed.error)}\n`);
  logger.error?.(
    `Fix the variables above in your .env / hosting secret store, then retry.\n${banner}\n`,
  );

  if (exitOnError) {
    setImmediate(() => process.exit(1));
  }

  return null;
}

function getEnv() {
  if (!cached) cached = validateEnv({ exitOnError: false });
  return cached;
}

function _resetForTests() {
  cached = null;
  cachedKey = null;
}

module.exports = {
  validateEnv,
  getEnv,
  envSchema,
  _resetForTests,
};
/**
 * BlockOps structured logger.
 *
 * Lightweight pino wrapper that:
 *   - Adds a request-correlation id to every log line.
 *   - Redacts sensitive fields (secret keys, JWT secrets, payment headers).
 *   - Falls back to a console-only logger when `pino` is unavailable.
 *
 * Usage:
 *   const { logger } = require('./utils/logger');
 *   const child = logger.child({ requestId: req.id, toolId: 'register_agent' });
 *   child.info('x402 payment verified');
 */

let pinoLib
try {
  pinoLib = require('pino')
} catch (err) {
  pinoLib = null
}

const REDACT_PATHS = [
  'privateKey',
  'private_key',
  'casperSecretKey',
  'casper_secret_key',
  'secret',
  'jwt',
  'token',
  'password',
  'X-Casper-Payment-Deploy-Hash',
  'x-casper-payment-deploy-hash',
  'authorization',
  'Authorization',
]

function makeFallbackLogger() {
  function emit(level) {
    return (obj, msg) => {
      if (typeof obj === 'string') {
        // eslint-disable-next-line no-console
        console[level === 'warn' ? 'warn' : level](JSON.stringify({ level, msg: obj }))
        return
      }
      const { msg: extractedMsg, ...rest } = obj || {}
      const finalMsg = extractedMsg ?? msg
      // eslint-disable-next-line no-console
      console[level === 'warn' ? 'warn' : level](
        JSON.stringify({ level, msg: finalMsg, ...rest }, null, 2),
      )
    }
  }
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    debug: emit('debug'),
    fatal: emit('fatal'),
    trace: emit('trace'),
    child(bindings) {
      const parent = {
        info: emit('info'),
        warn: emit('warn'),
        error: emit('error'),
        debug: emit('debug'),
        fatal: emit('fatal'),
        trace: emit('trace'),
      }
      parent.child = () => parent
      return parent
    },
  }
}

const baseConfig = {
  redact: { paths: REDACT_PATHS, remove: false, censor: '[REDACTED]' },
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'blockops-backend' },
}

// Use a synchronous destination so the logger doesn't keep a worker
// thread alive on shutdown. Sync writes are fine for the modest log
// volume this service produces; if profiling later shows the sync
// writes are a bottleneck we can swap in an async destination and a
// flush-on-exit hook. Writing directly to fd 1 (stdout) avoids the
// pino transport that would otherwise spawn a thread that holds the
// process open past the test boundary.
const logger = pinoLib
  ? pinoLib(baseConfig, pinoLib.destination(1))
  : makeFallbackLogger()

module.exports = {
  logger,
  REDACT_PATHS,
}

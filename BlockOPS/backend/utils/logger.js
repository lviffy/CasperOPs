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
      const { msg, ...rest } = obj || {}
      // eslint-disable-next-line no-console
      console[level === 'warn' ? 'warn' : level](
        JSON.stringify({ level, msg, ...rest }, null, 2),
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
      return makeFallbackLogger().info
        ? {
            info: emit('info'),
            warn: emit('warn'),
            error: emit('error'),
            debug: emit('debug'),
            child: () => this,
          }
        : this
    },
  }
}

const baseConfig = {
  redact: { paths: REDACT_PATHS, remove: false, censor: '[REDACTED]' },
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'blockops-backend' },
}

const logger = pinoLib
  ? pinoLib(baseConfig)
  : makeFallbackLogger()

module.exports = {
  logger,
  REDACT_PATHS,
}

/**
 * Request correlation middleware.
 *
 * Generates a per-request UUID and attaches it to `req.id` so every log line
 * in the request handler chain can be correlated. Echoes the id back in the
 * `X-Request-Id` response header so the frontend can include it in bug
 * reports.
 */

const crypto = require('crypto')
const { logger } = require('../utils/logger')

function requestContext() {
  return function requestContextMiddleware(req, res, next) {
    const incoming = req.header('X-Request-Id')
    req.id = incoming && /^[a-zA-Z0-9._-]{6,128}$/.test(incoming) ? incoming : crypto.randomUUID()
    res.setHeader('X-Request-Id', req.id)
    req.log = logger.child({ requestId: req.id })
    const start = Date.now()
    res.on('finish', () => {
      req.log.info({
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }, 'request completed')
    })
    next()
  }
}

module.exports = { requestContext }

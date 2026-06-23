/**
 * Request correlation + metrics middleware.
 *
 * Generates a per-request UUID and attaches it to `req.id` so every log line
 * in the request handler chain can be correlated. Echoes the id back in the
 * `X-Request-Id` response header so the frontend can include it in bug
 * reports.
 *
 * Phase 26: also records HTTP metrics into the prom-client registry
 * exposed at `GET /metrics`. Uses the Express route template
 * (`/v1/tools/:toolId`) rather than the raw URL so label cardinality stays
 * bounded — a raw URL with a tool id per call would explode the registry.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger');
const {
  httpRequestsTotal,
  httpRequestDuration,
  routeLabel,
} = require('../utils/metrics');

function requestContext() {
  return function requestContextMiddleware(req, res, next) {
    const incoming = req.header('X-Request-Id');
    req.id = incoming && /^[a-zA-Z0-9._-]{6,128}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    req.log = logger.child({ requestId: req.id });
    const start = Date.now();

    // Start the histogram timer now. We add the status_code label when
    // the response finishes; the partial start with the static labels
    // is cheap and avoids a string template on the hot path.
    const endTimer = httpRequestDuration.startTimer({
      method: req.method,
      route: routeLabel(req),
    });

    res.on('finish', () => {
      const route = routeLabel(req);
      const statusCode = String(res.statusCode);
      const labels = { method: req.method, route, status_code: statusCode };
      httpRequestsTotal.inc(labels);
      try { endTimer({ status_code: statusCode }); } catch (_) {}
      req.log.info({
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }, 'request completed');
    });

    // 4xx/5xx BEFORE res.on('finish') fires for streamed errors (very rare
    // in this codebase but cheap insurance for catch-all error middleware).
    res.on('close', () => {
      if (!res.writableEnded) {
        const statusCode = String(res.statusCode || 0);
        const labels = { method: req.method, route: routeLabel(req), status_code: statusCode };
        httpRequestsTotal.inc(labels);
        try { endTimer({ status_code: statusCode }); } catch (_) {}
      }
    });

    next();
  };
}

module.exports = { requestContext };
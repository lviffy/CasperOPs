/**
 * Sentry integration for the CasperOPs backend.
 *
 * Initializes Sentry only when SENTRY_DSN is set so dev environments don't
 * accidentally ship traces. Wraps the error handler in a no-op when Sentry
 * is not installed.
 *
 * The frontend mirrors this in `frontend/lib/sentry.ts`.
 */

let Sentry
try {
  Sentry = require('@sentry/node')
} catch (err) {
  Sentry = null
}

const SENTRY_DSN = process.env.SENTRY_DSN || ''
const SENTRY_ENV = process.env.SENTRY_ENV || process.env.NODE_ENV || 'development'
const SENTRY_TRACES_SAMPLE_RATE = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05')

function initSentry(app) {
  if (!Sentry) {
    console.warn('[sentry] @sentry/node not installed; error reporting disabled.')
    return
  }
  if (!SENTRY_DSN) {
    console.info('[sentry] SENTRY_DSN not set; error reporting disabled.')
    return
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    integrations: Sentry.getDefaultIntegrations
      ? Sentry.getDefaultIntegrations({}).filter((i) => i.name !== 'OnUnhandledRejection')
      : [],
  })
  if (app && typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app)
  }
  console.info(`[sentry] initialized (env=${SENTRY_ENV}, sample=${SENTRY_TRACES_SAMPLE_RATE})`)
}

function captureException(err, context = {}) {
  if (!Sentry || !SENTRY_DSN) return
  Sentry.captureException(err, { extra: context })
}

module.exports = { initSentry, captureException }

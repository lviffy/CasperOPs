/**
 * Redis-backed pub-sub coordination event pool for CasperOPs agents.
 * Enables real-time message broadcasting and event coordination.
 */

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || null;
const log = logger.child({ component: 'eventPool' });

class EventPoolService {
  constructor() {
    this.pub = null;
    this.sub = null;
    this.subscriptions = new Map(); // topic -> callbacks array
    this.init();
  }

  init() {
    if (!REDIS_URL) {
      log.warn('Redis event pool disabled: REDIS_URL not set');
      return;
    }
    try {
      this.pub = new Redis(REDIS_URL, { lazyConnect: true });
      this.sub = new Redis(REDIS_URL, { lazyConnect: true });

      this.pub.connect().catch(err => log.error({ err: err.message }, 'Publisher connection failed'));
      this.sub.connect().then(() => {
        this.sub.on('message', (channel, message) => {
          log.info({ channel, message }, 'Received event message');
          const callbacks = this.subscriptions.get(channel) || [];
          for (const cb of callbacks) {
            try {
              cb(JSON.parse(message));
            } catch (err) {
              cb(message);
            }
          }
        });
      }).catch(err => log.error({ err: err.message }, 'Subscriber connection failed'));
    } catch (err) {
      log.error({ err: err.message }, 'Failed to initialize Redis event pool');
    }
  }

  async publishEvent(topic, payload) {
    log.info({ topic, payload }, 'Publishing event');
    if (!this.pub) {
      // In-memory fallback if Redis is not configured
      const callbacks = this.subscriptions.get(topic) || [];
      for (const cb of callbacks) {
        cb(payload);
      }
      return true;
    }
    try {
      const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
      await this.pub.publish(topic, msg);
      return true;
    } catch (err) {
      log.error({ topic, err: err.message }, 'Failed to publish event');
      return false;
    }
  }

  subscribeToEvent(topic, callback) {
    log.info({ topic }, 'Subscribing to event');
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
      if (this.sub) {
        this.sub.subscribe(topic).catch(err => log.error({ topic, err: err.message }, 'Subscribe failed'));
      }
    }
    this.subscriptions.get(topic).push(callback);
  }

  unsubscribeFromEvent(topic, callback) {
    if (!this.subscriptions.has(topic)) return;
    const list = this.subscriptions.get(topic);
    const index = list.indexOf(callback);
    if (index !== -1) {
      list.splice(index, 1);
    }
    if (list.length === 0) {
      this.subscriptions.delete(topic);
      if (this.sub) {
        this.sub.unsubscribe(topic).catch(err => log.error({ topic, err: err.message }, 'Unsubscribe failed'));
      }
    }
  }

  async close() {
    if (this.pub) {
      try { await this.pub.quit(); } catch (_) {}
    }
    if (this.sub) {
      try { await this.sub.quit(); } catch (_) {}
    }
  }
}

const eventPool = new EventPoolService();

module.exports = eventPool;

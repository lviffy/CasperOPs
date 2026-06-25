'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// Mock blockchain before requiring directToolExecutor
const { Keys } = require('casper-js-sdk');
const fakeBlockchain = {
  getClient: () => ({
    deploy: async () => 'fake-deploy-hash-message-board',
    getStateRootHash: async () => 'state-root',
    getAccountBalanceUrefByPublicKey: async () => 'uref',
    getAccountBalance: async () => '1000000000',
    getBlockState: async (stateRootHash, cleanHash, [key]) => {
      if (key.startsWith('messages_')) {
        return {
          storedValue: {
            CLValue: {
              parsed: 'swarm agreement reached'
            }
          }
        };
      }
      if (key.startsWith('writers_')) {
        return {
          storedValue: {
            CLValue: {
              parsed: '010101010101010101010101010101010101010101010101010101010101010101'
            }
          }
        };
      }
      return null;
    }
  }),
  getKeysFromHex: (pk) => {
    return Keys.Ed25519.new();
  },
  getAccountBalance: async () => '100000000000',
  sendDeploy: async () => 'fake-deploy-hash-message-board',
};

require.cache[require.resolve('../utils/blockchain')] = {
  id: require.resolve('../utils/blockchain'),
  filename: require.resolve('../utils/blockchain'),
  loaded: true,
  exports: fakeBlockchain,
  children: [],
  paths: [],
};

// Disable Redis for unit tests so they don't depend on a running Redis instance
process.env.REDIS_URL = '';
const { post_message, get_message } = require('../services/directToolExecutor');
const eventPool = require('../services/eventPoolService');

describe('MessageBoard Swarm Coordination Integration', () => {
  before(() => {
    process.env.CASPER_MESSAGE_BOARD_HASH = 'mock-message-board-hash';
  });

  it('should post a message to on-chain MessageBoard and propagate to Redis event pool', async () => {
    let receivedEvent = null;
    const topic = 'swarm-debate';
    const messageText = 'Risk Agent: approved';

    // Subscribe to the topic in the event pool
    eventPool.subscribeToEvent(topic, (data) => {
      receivedEvent = data;
    });

    const res = await post_message({
      topic,
      message: messageText,
      secretKey: '9a504a9ddb6015c2724147e2e0756fa728e8455d5189f094eab5c8a146df639c'
    });

    assert.equal(res.success, true);
    assert.equal(res.deployHash, 'fake-deploy-hash-message-board');
    assert.equal(res.topic, topic);
    assert.equal(res.message, messageText);

    // Verify Redis event pool propagation (with a short wait for async pub-sub)
    for (let i = 0; i < 20; i++) {
      if (receivedEvent) break;
      await new Promise(r => setTimeout(r, 50));
    }

    assert.ok(receivedEvent);
    assert.equal(receivedEvent.topic, topic);
    assert.equal(receivedEvent.message, messageText);
  });

  it('should fetch the latest message from on-chain MessageBoard', async () => {
    const topic = 'swarm-debate';
    const res = await get_message({ topic });

    assert.equal(res.success, true);
    assert.equal(res.topic, topic);
    assert.equal(res.message, 'swarm agreement reached');
    assert.equal(res.sender, '010101010101010101010101010101010101010101010101010101010101010101');
  });
});

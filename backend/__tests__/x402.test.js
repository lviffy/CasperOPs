/**
 * Unit tests for the x402 challenge + verification middleware. These tests
 * do NOT hit the real Casper RPC; they mock `fetch` and exercise the
 * challenge/verify state machine.
 */

const { describe, it, before, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const sinon = require('sinon')

// Stub the casper-js-sdk before requiring the middleware.
const originalFetch = global.fetch

describe('x402 middleware', () => {
  let x402Challenge, x402Verify, challengeFor, chains

  before(() => {
    process.env.CASPER_RPC_URL = 'https://rpc.testnet.casper.live/rpc'
    process.env.CASPER_PAYMENT_RECIPIENT_PUBLIC_KEY =
      '01' + 'a'.repeat(64)
    process.env.CASPER_CEP18_CONTRACT_HASH =
      'hash-' + 'b'.repeat(64)
    ;({ x402Challenge, x402Verify, challengeFor } = require('../middleware/x402-verify'))
    ;({ x402Challenge: x402ChallengeFactory } = require('../middleware/x402'))
    chains = require('../utils/chains')
  })

  afterEach(() => {
    sinon.restore()
    global.fetch = originalFetch
  })

  it('TOOL_PRICING exposes a free and paid tier per tool', () => {
    assert.equal(chains.getToolPrice('get_balance').tier, 'free')
    assert.equal(chains.getToolPrice('register_agent').tier, 'paid')
    assert.equal(chains.getToolPrice('register_agent').priceMotes, 500_000_000)
  })

  it('motesToCspr / csprToMotes round-trip', () => {
    assert.equal(chains.motesToCspr(500_000_000), '0.50')
    assert.equal(chains.csprToMotes('0.50'), '500000000')
  })

  it('isFreeTool is true for get_reputation', () => {
    assert.equal(chains.isFreeTool('get_reputation'), true)
    assert.equal(chains.isFreeTool('mint_nft'), false)
  })

  it('challengeFor returns the canonical 402 challenge shape', () => {
    const ch = challengeFor('register_agent')
    assert.equal(ch.toolId, 'register_agent')
    assert.equal(ch.priceCspr, '0.50')
    assert.equal(ch.priceMotes, '500000000')
    assert.match(ch.payToPublicKey, /^01[0-9a-f]{64}$/)
  })

  it('x402Verify passes through free tools without headers', async () => {
    const mw = x402Verify()
    const req = { method: 'POST', params: { toolId: 'get_balance' }, body: {}, header: () => undefined }
    let nextCalled = false
    await mw(req, {}, () => { nextCalled = true })
    assert.equal(nextCalled, true)
  })

  it('x402Verify responds 402 when the payment header is missing for a paid tool', async () => {
    const mw = x402Verify()
    const req = { method: 'POST', params: { toolId: 'register_agent' }, body: {}, header: () => undefined }
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() }
    await mw(req, res, () => { throw new Error('next() should not be called') })
    assert.equal(res.status.calledWith(402), true)
  })

  it('x402Verify responds 400 when the payer header is missing', async () => {
    const mw = x402Verify()
    const req = {
      method: 'POST',
      params: { toolId: 'register_agent' },
      body: {},
      header: (h) => (h === 'X-Casper-Payment-Deploy-Hash' ? 'hash-123' : undefined),
    }
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() }
    await mw(req, res, () => {})
    assert.equal(res.status.calledWith(400), true)
  })

  it('x402Verify validates the deploy against the RPC and attaches req.x402', async () => {
    const mw = x402Verify()
    const deployHash = 'hash-' + 'c'.repeat(64)
    const payer = '01' + 'd'.repeat(64)
    const req = {
      method: 'POST',
      params: { toolId: 'register_agent' },
      body: {},
      header: (h) => {
        if (h === 'X-Casper-Payment-Deploy-Hash') return deployHash
        if (h === 'X-Casper-Payment-Payer-PublicKey') return payer
        return undefined
      },
    }
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() }
    let nextArgs
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        result: {
          execution_results: [{ error_message: null }],
          deploy: {
            session: {
              StoredContractByHash: {
                args: [
                  ['recipient', payer.slice(2)],
                  ['amount', '500000000'],
                ],
              },
            },
          },
        },
      }),
    })
    await mw(req, res, (err) => { nextArgs = err })
    assert.equal(typeof req.x402, 'object')
    assert.equal(req.x402.toolId, 'register_agent')
    assert.equal(req.x402.payerPublicKey, payer)
    assert.equal(req.x402.deployHash, deployHash)
  })

  it('x402Verify rejects a deploy with amount below the required price', async () => {
    const mw = x402Verify()
    const deployHash = 'hash-' + 'e'.repeat(64)
    const payer = '01' + 'f'.repeat(64)
    const req = {
      method: 'POST',
      params: { toolId: 'register_agent' },
      body: {},
      header: (h) => {
        if (h === 'X-Casper-Payment-Deploy-Hash') return deployHash
        if (h === 'X-Casper-Payment-Payer-PublicKey') return payer
        return undefined
      },
    }
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() }
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => ({
        result: {
          execution_results: [{ error_message: null }],
          deploy: {
            session: {
              StoredContractByHash: {
                args: [
                  ['recipient', payer.slice(2)],
                  ['amount', '100000000'], // too small
                ],
              },
            },
          },
        },
      }),
    })
    await mw(req, res, () => { throw new Error('next() should not be called') })
    assert.equal(res.status.calledWith(402), true)
  })
})

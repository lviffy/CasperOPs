/**
 * CSPR.click mock for Playwright E2E tests.
 *
 * CSPR.click is an iframe-based SDK that requires a real browser
 * extension or mobile wallet — neither of which Playwright provides.
 * Instead of skipping wallet flows, this mock implements the same
 * postMessage contract that the SDK listens for, so the production
 * `lib/wallet.ts` glue code can run unmodified.
 *
 * Test scenarios:
 *   - "happy": connect returns a fake public key, signDeploy returns
 *     a deterministic deploy hash.
 *   - "user_rejected_sign": connect or signDeploy throws the same
 *     `user_rejected_sign` error code CSPR.click raises.
 *   - "insufficient_balance": fetchCsprBalance returns 0.
 *
 * Usage in a spec:
 *   test.beforeEach(async ({ context }) => {
 *     await context.addInitScript(CSPR_CLICK_MOCK_HAPPY)
 *   })
 */

export const MOCK_PUBLIC_KEY =
  '01' + 'a'.repeat(64) // 0x prefix not used; valid ed25519 hex pubkey shape

export const MOCK_DEPLOY_HASH =
  'b'.repeat(64)

export const CSPR_CLICK_MOCK_HAPPY = `
  ;(function installCsprClickMock() {
    const PUBLIC_KEY = ${JSON.stringify(MOCK_PUBLIC_KEY)}
    const DEPLOY_HASH = ${JSON.stringify(MOCK_DEPLOY_HASH)}

    function postMessage_(event) {
      try {
        window.parent.postMessage(event, '*')
      } catch (e) {}
    }

    // The SDK expects a postMessage contract with a {type, payload}
    // shape. We respond to "connect", "signDeploy", "signMessage",
    // "getActiveAccount", and "disconnect" requests.
    window.addEventListener('message', function (event) {
      const data = event.data
      if (!data || typeof data !== 'object' || !data.type) return
      const id = data.id
      const respond = (ok, payload) => postMessage_({
        type: 'csprclick:response',
        id,
        ok,
        payload,
      })

      switch (data.type) {
        case 'csprclick:request:connect':
          return respond(true, { publicKey: PUBLIC_KEY, provider: 'casper-wallet' })
        case 'csprclick:request:disconnect':
          return respond(true, { ok: true })
        case 'csprclick:request:getActiveAccount':
          return window.__csprClickConnected__
            ? respond(true, { publicKey: PUBLIC_KEY, provider: 'casper-wallet' })
            : respond(false, { code: 'not_connected' })
        case 'csprclick:request:getKnownAccounts':
          return respond(true, { accounts: [{ publicKey: PUBLIC_KEY, provider: 'casper-wallet' }] })
        case 'csprclick:request:signDeploy':
          return respond(true, { deployHash: DEPLOY_HASH })
        case 'csprclick:request:signMessage':
          return respond(true, { signature: '00'.repeat(64) })
        default:
          // Unknown request type — silent ignore so the SDK can decide.
          break
      }
    })

    window.__CSPRCLICK_MOCK__ = {
      publicKey: PUBLIC_KEY,
      deployHash: DEPLOY_HASH,
      connected: false,
    }
  })()
`

export const CSPR_CLICK_MOCK_USER_REJECTED = `
  ;(function installCsprClickRejectMock() {
    const respond = (id, ok, payload) => {
      window.parent.postMessage({ type: 'csprclick:response', id, ok, payload }, '*')
    }
    window.addEventListener('message', function (event) {
      const data = event.data
      if (!data || !data.type) return
      switch (data.type) {
        case 'csprclick:request:connect':
          return respond(data.id, false, { code: 'user_rejected_sign', message: 'user rejected' })
        case 'csprclick:request:signDeploy':
          return respond(data.id, false, { code: 'user_rejected_sign', message: 'user rejected' })
        case 'csprclick:request:getActiveAccount':
          return respond(data.id, false, { code: 'not_connected' })
        default:
          break
      }
    })
  })()
`

export const CSPR_CLICK_MOCK_INSUFFICIENT_BALANCE = `
  ;(function installInsufficientMock() {
    const PUBLIC_KEY = ${JSON.stringify(MOCK_PUBLIC_KEY)}
    const respond = (id, ok, payload) => {
      window.parent.postMessage({ type: 'csprclick:response', id, ok, payload }, '*')
    }
    window.addEventListener('message', function (event) {
      const data = event.data
      if (!data || !data.type) return
      switch (data.type) {
        case 'csprclick:request:connect':
          return respond(data.id, true, { publicKey: PUBLIC_KEY, provider: 'casper-wallet' })
        case 'csprclick:request:signDeploy':
          return respond(data.id, true, { deployHash: 'c'.repeat(64) })
        case 'csprclick:request:getActiveAccount':
          return respond(data.id, true, { publicKey: PUBLIC_KEY, provider: 'casper-wallet' })
        case 'csprclick:request:signMessage':
          return respond(data.id, true, { signature: '00'.repeat(64) })
        default:
          break
      }
    })
  })()
`
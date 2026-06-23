# BlockOps — Deploy to Testnet Checklist

## 1. Generate signer + fund it

```bash
cd contract
node scripts/generate-signer.js
# → creates backend/secrets/testnet-signer.{pem,json}
# → prints public key (01...)
```

Copy the **public key** (01-prefixed, 66 hex chars). Go to
[Casper Testnet Faucet](https://testnet.cspr.live/tools/faucet)
and fund it with 200 CSPR (enough for 10+ contract deploys + e2e runs).

Copy the **private key** (64 hex, no `0x`) into `backend/.env`:
```
CASPER_SECRET_KEY=<64hex>
```

## 2. Build contracts

```bash
cd contract
export RUSTFLAGS="-C link-arg=--unresolved-symbols=import-dynamic"
cargo odra build
# → wasm/*.wasm files
```

## 3. Deploy to testnet

```bash
cd contract
node scripts/deploy.js
```

The script prints 6 contract hashes:
- `CASPER_AGENT_FACTORY_HASH`
- `CASPER_REPUTATION_HASH`
- `CASPER_ESCROW_HASH`
- `CASPER_COMPLIANCE_HASH`
- `CASPER_CEP18_HASH`
- `CASPER_CEP78_HASH`

## 4. Wire hashes into backend

Edit `backend/.env`:
```
CASPER_AGENT_FACTORY_HASH=hash-<64hex>
CASPER_REPUTATION_HASH=hash-<64hex>
CASPER_ESCROW_HASH=hash-<64hex>
CASPER_COMPLIANCE_HASH=hash-<64hex>
```

## 5. Wire hashes into frontend

Edit `frontend/.env.local`:
```
NEXT_PUBLIC_AGENT_FACTORY_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_REPUTATION_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_ESCROW_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_COMPLIANCE_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_CEP18_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_CEP78_CONTRACT_HASH=hash-<64hex>
NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY=01<64hex>   # same as signer pubkey
```

## 6. Run e2e test

```bash
# Dryrun first:
./scripts/e2e-testnet-phase22.sh

# Then live:
./scripts/e2e-testnet-phase22.sh --skip-deploy --live
```

## 7. Submit staging URL

- **Frontend**: `vercel --prod` (from `frontend/`)
- **Backend**: `fly deploy` (from `backend/`)

Set all env vars on Vercel AND Fly.io (use `fly secrets set KEY=VAL`).

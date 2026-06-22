#!/usr/bin/env node
/**
 * Casper Testnet deployment script for BlockOps Odra contracts.
 *
 * Usage:
 *   node deploy.js                 # deploy all 4 contracts
 *   node deploy.js --only=escrow   # deploy only the Escrow contract
 *
 * Required env vars (or in backend/.env):
 *   CASPER_RPC_URL           - default https://rpc.testnet.casper.live/rpc
 *   CASPER_SECRET_KEY        - hex secret key from Casper wallet (testnet)
 */

const fs = require('fs');
const path = require('path');
const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder, CLPublicKey } = require('casper-js-sdk');

const dotenvPath = path.resolve(__dirname, '../../backend/.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const RPC_URL = process.env.CASPER_RPC_URL || 'https://rpc.testnet.casper.live/rpc';
const SECRET = process.env.CASPER_SECRET_KEY;

if (!SECRET) {
  console.error('❌  CASPER_SECRET_KEY is not set. Add it to backend/.env first.');
  process.exit(1);
}

const cleanSecret = SECRET.startsWith('0x') ? SECRET.slice(2) : SECRET;
const secretBytes = Buffer.from(cleanSecret, 'hex');
let keys;
if (secretBytes.length === 32) {
  keys = Keys.Ed25519.loadKeyPairFromPrivateKey(secretBytes);
} else if (secretBytes.length === 33 || secretBytes.length === 32) {
  // secp256k1 secret keys in casper-js-sdk are 32 bytes; tolerate a 33-byte export.
  keys = Keys.Secp256K1.loadKeyPairFromPrivateKey(secretBytes.subarray(0, 32));
} else {
  throw new Error(`Unsupported secret key length: ${secretBytes.length} bytes.`);
}
const algorithm = keys.publicKey.isEd25519() ? 'ed25519' : 'secp256k1';
console.log(`🔑  Deployer key loaded (${algorithm}): ${keys.publicKey.toHex()}`);

const WASM_DIR = path.resolve(__dirname, 'wasm');

const PAYMENT_CSPR = 250_000_000_000;

function buildArgs(spec, deployerPublicKey) {
  const clArgs = {};
  for (const [name, value] of Object.entries(spec.args || {})) {
    if (value === 'self') {
      clArgs[name] = CLValueBuilder.key(deployerPublicKey);
    } else if (value && typeof value === 'string' && value.startsWith('account_hash=')) {
      const hex = value.slice('account_hash='.length).replace(/^0x/, '');
      clArgs[name] = CLValueBuilder.byteArray(Uint8Array.from(Buffer.from(hex, 'hex')));
    } else {
      clArgs[name] = value;
    }
  }
  return clArgs;
}

const CONTRACTS = [
  {
    name: 'AgentFactory',
    file: 'AgentFactory.wasm',
    payment: PAYMENT_CSPR,
    args: {},
    envKey: 'CASPER_AGENT_FACTORY_HASH',
  },
  {
    name: 'Reputation',
    file: 'Reputation.wasm',
    payment: PAYMENT_CSPR,
    args: { validator_address: 'self' },
    envKey: 'CASPER_REPUTATION_HASH',
  },
  {
    name: 'Escrow',
    file: 'Escrow.wasm',
    payment: PAYMENT_CSPR,
    args: { backend: 'self', treasury: 'self' },
    envKey: 'CASPER_ESCROW_HASH',
  },
  {
    name: 'Compliance',
    file: 'Compliance.wasm',
    payment: PAYMENT_CSPR,
    args: { authority: 'self' },
    envKey: 'CASPER_COMPLIANCE_HASH',
  },
  {
    name: 'Cep18Token',
    file: 'Cep18Token.wasm',
    payment: PAYMENT_CSPR,
    args: {
      name: 'Test CSPR',
      symbol: 'tCSPR',
      decimals: 9,
      total_supply: '1000000000000000000', // 1e18 motes
    },
    envKey: 'CASPER_CEP18_HASH',
  },
  {
    name: 'Cep78Nft',
    file: 'Cep78Nft.wasm',
    payment: PAYMENT_CSPR,
    args: {
      collection_name: 'BlockOps Sample Collection',
      collection_symbol: 'BOSC',
      total_token_supply: '1000',
    },
    envKey: 'CASPER_CEP78_HASH',
  },
];

function buildDeploy({ wasm, payment, args }) {
  const params = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');
  const runtimeArgs = RuntimeArgs.fromMap(args);
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, runtimeArgs);
  const pmt = DeployUtil.standardPayment(payment);
  const deploy = DeployUtil.makeDeploy(params, session, pmt);
  return DeployUtil.signDeploy(deploy, keys);
}async function rpc(method, params = {}) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

async function deployContract(spec) {
  const wasmPath = path.join(WASM_DIR, spec.file);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM not found at ${wasmPath}. Run: cd contract && cargo odra build`);
  }
  const wasm = new Uint8Array(fs.readFileSync(wasmPath));
  const clArgs = buildArgs(spec, keys.publicKey);
  const signed = buildDeploy({ wasm, payment: spec.payment, args: clArgs });
  const result = await rpc('account_put_deploy', DeployUtil.deployToJson(signed));
  console.log(`✅  ${spec.name}: ${result.deploy_hash}`);
  console.log(`    https://testnet.cspr.live/deploy/${result.deploy_hash}`);
  if (spec.envKey) {
    console.log(`    export ${spec.envKey}=${result.deploy_hash}`);
  }
  return result.deploy_hash;
}

async function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  const targets = only
    ? CONTRACTS.filter((c) => c.name.toLowerCase() === only.toLowerCase())
    : CONTRACTS;
  if (!targets.length) {
    console.error(`No contract matches "${only}". Available: ${CONTRACTS.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }
  console.log(`🚀 Deploying ${targets.length} contract(s) to Casper Testnet (RPC: ${RPC_URL})…\n`);
  for (const spec of targets) {
    await deployContract(spec);
  }
  console.log('\n🎉 All deploys submitted. Track them at https://testnet.cspr.live/');
}

main().catch((err) => {
  console.error('❌  Deploy failed:', err.message);
  process.exit(1);
});

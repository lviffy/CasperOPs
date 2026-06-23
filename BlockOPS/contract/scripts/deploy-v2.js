#!/usr/bin/env node
/**
 * Casper 2.x deploy script using casper-js-sdk v5.
 * Uses put_transaction with category=InstallUpgrade (required for Casper 2.x).
 *
 * Usage:
 *   node scripts/deploy-v2.js                   # deploy all contracts
 *   node scripts/deploy-v2.js --only=AgentFactory
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') });

const {
  RpcClient,
  SessionBuilder,
  PrivateKey,
  CLValue,
  Args,
} = require('casper-js-sdk');

const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY || '';
const SECRET         = process.env.CASPER_SECRET_KEY;

if (!SECRET) {
  console.error('❌  CASPER_SECRET_KEY not set in backend/.env');
  process.exit(1);
}

if (!CSPR_CLOUD_KEY) {
  console.error('❌  CSPR_CLOUD_API_KEY not set in backend/.env');
  process.exit(1);
}

// Custom RPC client that adds Authorization header
class AuthRpcClient extends RpcClient {
  constructor(url, apiKey) {
    super(url);
    this._apiKey = apiKey;
  }
  async processRequest(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const res = await fetch(this.nodeUrl || 'https://node.testnet.cspr.cloud/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': this._apiKey,
      },
      body,
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(`JSON-RPC Error: ${json.error.message} (code: ${json.error.code}, data: ${JSON.stringify(json.error.data)})`);
    }
    return json;
  }
}

const RPC_URL = 'https://node.testnet.cspr.cloud/rpc';
const rpc = new AuthRpcClient(RPC_URL, CSPR_CLOUD_KEY);

const WASM_DIR = path.resolve(__dirname, '../wasm');

// Helper to wrap values as CL Args
function buildArgs(spec, deployerPublicKey) {
  const map = {};
  for (const [name, value] of Object.entries(spec.args || {})) {
    if (value === 'self') {
      map[name] = CLValue.newCLKey(deployerPublicKey);
    } else if (value && typeof value === 'string' && value.startsWith('account_hash=')) {
      const hex = value.slice('account_hash='.length).replace(/^0x/, '');
      map[name] = CLValue.newCLByteArray(Uint8Array.from(Buffer.from(hex, 'hex')));
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      map[name] = CLValue.newCLUInt256(value);
    } else if (typeof value === 'string') {
      map[name] = CLValue.newCLString(value);
    } else if (typeof value === 'number' && value >= 0 && value <= 255) {
      map[name] = CLValue.newCLUint8(value);
    } else if (typeof value === 'number') {
      map[name] = CLValue.newCLUint64(value.toString());
    }
  }
  return Args.fromMap(map);
}

const CONTRACTS = [
  { name: 'AgentFactory', file: 'AgentFactory.wasm', args: {}, envKey: 'CASPER_AGENT_FACTORY_HASH' },
  { name: 'Reputation',   file: 'Reputation.wasm',   args: { validator_address: 'self' }, envKey: 'CASPER_REPUTATION_HASH' },
  { name: 'Escrow',       file: 'Escrow.wasm',       args: { backend: 'self', treasury: 'self' }, envKey: 'CASPER_ESCROW_HASH' },
  { name: 'Compliance',   file: 'Compliance.wasm',   args: { authority: 'self' }, envKey: 'CASPER_COMPLIANCE_HASH' },
  {
    name: 'Cep18Token', file: 'Cep18Token.wasm',
    args: { name: 'Test CSPR', symbol: 'tCSPR', decimals: 9, total_supply: '1000000000000000000' },
    envKey: 'CASPER_CEP18_HASH',
  },
  {
    name: 'Cep78Nft', file: 'Cep78Nft.wasm',
    args: { collection_name: 'BlockOps Sample Collection', collection_symbol: 'BOSC', total_token_supply: 1000, minter: 'self' },
    envKey: 'CASPER_CEP78_HASH',
  },
];

async function getAccountNamedKeys(publicKey) {
  try {
    const info = await rpc.getAccountInfo(null, publicKey);
    return info?.account?.namedKeys || [];
  } catch (e) {
    return [];
  }
}

function updateEnvFile(key, value) {
  const envPath = path.resolve(__dirname, '../../backend/.env');
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^(${key}[ \\t]*=[ \\t]*)[^\\r\\n]*`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
  console.log(`📝  Updated ${key}=${value} in backend/.env`);
}

async function deployContract(spec, privateKey) {
  const wasmPath = path.join(WASM_DIR, spec.file);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM not found: ${wasmPath}. Run: cargo odra build`);
  }
  const wasm = fs.readFileSync(wasmPath);

  console.log(`🔍  Fetching named keys of the deployer account before deployment...`);
  const keysBefore = await getAccountNamedKeys(privateKey.publicKey);
  const namedKeysBeforeSet = new Set(keysBefore.map(k => k.name));

  // Build contract arguments
  const map = {};
  for (const [name, value] of Object.entries(spec.args || {})) {
    if (value === 'self') {
      map[name] = CLValue.newCLKey(privateKey.publicKey);
    } else if (value && typeof value === 'string' && value.startsWith('account_hash=')) {
      const hex = value.slice('account_hash='.length).replace(/^0x/, '');
      map[name] = CLValue.newCLByteArray(Uint8Array.from(Buffer.from(hex, 'hex')));
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      map[name] = CLValue.newCLUInt256(value);
    } else if (typeof value === 'string') {
      map[name] = CLValue.newCLString(value);
    } else if (typeof value === 'number' && value >= 0 && value <= 255) {
      map[name] = CLValue.newCLUint8(value);
    } else if (typeof value === 'number') {
      map[name] = CLValue.newCLUint64(value.toString());
    }
  }

  // Insert Odra configuration arguments required by the installer WASM
  map['odra_cfg_constructor'] = CLValue.newCLString('init');
  map['odra_cfg_package_hash_key_name'] = CLValue.newCLString(spec.name);
  map['odra_cfg_allow_key_override'] = CLValue.newCLValueBool(true);
  map['odra_cfg_is_upgrade'] = CLValue.newCLValueBool(false);
  map['odra_cfg_is_upgradable'] = CLValue.newCLValueBool(true);

  const clArgs = Args.fromMap(map);

  console.log(`🛠️   Building transaction for ${spec.name}...`);
  // Build a Casper 2.x Session InstallUpgrade transaction
  const transaction = new SessionBuilder()
    .from(privateKey.publicKey)
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(clArgs)
    .chainName('casper-test')
    .payment(250_000_000_000)
    .build();

  console.log(`🔑  Signing transaction...`);
  await transaction.sign(privateKey);

  console.log(`🚀  Submitting transaction to Casper Testnet...`);
  const result = await rpc.putTransaction(transaction);
  const txHash = result.transactionHash.toHex();
  console.log(`📡  Submitted: ${txHash}`);
  console.log(`⏳  Waiting for confirmation...`);

  // Wait for confirmation
  const info = await rpc.waitForTransaction(transaction, 120_000);
  const execResult = info.executionInfo?.executionResult;
  if (execResult?.errorMessage) {
    throw new Error(`Transaction reverted: ${execResult.errorMessage}`);
  }

  console.log(`✨  Confirmed! Fetching new named keys to extract contract hash...`);
  // Wait 2 seconds for state to settle
  await new Promise(r => setTimeout(r, 2000));
  const keysAfter = await getAccountNamedKeys(privateKey.publicKey);
  const newKeys = keysAfter.filter(k => !namedKeysBeforeSet.has(k.name));

  let contractHash = '';
  if (newKeys.length > 0) {
    // If there is a key matching the contract name (case-insensitive)
    const matchingKey = newKeys.find(k => k.name.toLowerCase().includes(spec.name.toLowerCase()));
    const keyToUse = matchingKey || newKeys[0];
    const fullKeyStr = keyToUse.key.toPrefixedString ? keyToUse.key.toPrefixedString() : keyToUse.key.toString();
    contractHash = fullKeyStr.substring(fullKeyStr.length - 64);
    console.log(`🎯  Detected new named key: "${keyToUse.name}" -> ${contractHash}`);
  } else {
    // Fallback: search all named keys for a match
    const matchingKey = keysAfter.find(k => k.name.toLowerCase().includes(spec.name.toLowerCase()));
    if (matchingKey) {
      const fullKeyStr = matchingKey.key.toPrefixedString ? matchingKey.key.toPrefixedString() : matchingKey.key.toString();
      contractHash = fullKeyStr.substring(fullKeyStr.length - 64);
      console.log(`🎯  Found existing named key: "${matchingKey.name}" -> ${contractHash}`);
    } else {
      console.log(`⚠️   No new named key found. Using transaction hash ${txHash} as fallback.`);
      contractHash = txHash;
    }
  }

  if (spec.envKey && contractHash) {
    updateEnvFile(spec.envKey, contractHash);
  }
  return contractHash;
}

async function main() {
  // Load private key
  const cleanSecret = SECRET.startsWith('0x') ? SECRET.slice(2) : SECRET;
  let privateKey;
  try {
    privateKey = await PrivateKey.fromHex(cleanSecret, 1);
  } catch (e) {
    try {
      privateKey = await PrivateKey.fromHex(cleanSecret, 2);
    } catch (err) {
      throw new Error(`Failed to parse CASPER_SECRET_KEY as Ed25519 (type 1) or Secp256K1 (type 2): ${err.message}`);
    }
  }
  console.log(`🔑  Deployer public key: ${privateKey.publicKey.toHex()}`);

  const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
  const targets = only
    ? CONTRACTS.filter(c => c.name.toLowerCase() === only.toLowerCase())
    : CONTRACTS;

  if (!targets.length) {
    console.error(`No contract matches "${only}". Available: ${CONTRACTS.map(c => c.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀  Deploying ${targets.length} contract(s) to Casper 2.x Testnet...\n`);
  for (const spec of targets) {
    try {
      console.log(`------------------------------------------------------------`);
      console.log(`🎬  Starting deployment of ${spec.name}...`);
      const hash = await deployContract(spec, privateKey);
      console.log(`✅  ${spec.name} successfully deployed! Hash: ${hash}`);
    } catch (e) {
      console.error(`❌  ${spec.name} failed:`, e.message);
      process.exit(1);
    }
  }
  console.log(`------------------------------------------------------------`);
  console.log('\n🎉  All target contracts processed successfully!');
}

main().catch(e => { console.error('❌  Fatal:', e.stack || e.message); process.exit(1); });

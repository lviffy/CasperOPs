#!/usr/bin/env node
/**
 * Generate a Casper testnet ed25519 keypair for the BlockOps deployer.
 *
 * Usage:
 *   node generate-signer.js                # writes backend/secrets/testnet-signer.pem
 *   node generate-signer.js --stdout       # prints <public>:<private> to stdout only
 *
 * The PEM file is appended to backend/.gitignore so it never gets committed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Keys } = require('casper-js-sdk');

const SECRETS_DIR = path.resolve(__dirname, '../../backend/secrets');
const PEM_PATH = path.join(SECRETS_DIR, 'testnet-signer.pem');
const JSON_PATH = path.join(SECRETS_DIR, 'testnet-signer.json');
const GITIGNORE_PATH = path.resolve(__dirname, '../../backend/.gitignore');

const stdout = process.argv.includes('--stdout');

function ensureGitignored() {
  let lines = [];
  if (fs.existsSync(GITIGNORE_PATH)) {
    lines = fs.readFileSync(GITIGNORE_PATH, 'utf8').split(/\r?\n/);
  }
  const wanted = ['secrets/', 'secrets/*', 'testnet-signer.pem', 'testnet-signer.json'];
  const merged = Array.from(new Set([...lines, ...wanted])).filter(Boolean);
  fs.writeFileSync(GITIGNORE_PATH, merged.join('\n') + '\n');
}

function main() {
  const ed = Keys.Ed25519.new();
  const publicKey = ed.publicKey.toHex();
  const privateKey = ed.privateKey; // hex without 0x

  if (stdout) {
    process.stdout.write(`${publicKey}:${privateKey}\n`);
    return;
  }

  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  ensureGitignored();

  const pem =
    '-----BEGIN BLOCKOPS TESTNET SIGNER-----\n' +
    publicKey +
    '\n' +
    privateKey +
    '\n' +
    '-----END BLOCKOPS TESTNET SIGNER-----\n';

  fs.writeFileSync(PEM_PATH, pem, { mode: 0o600 });
  fs.writeFileSync(
    JSON_PATH,
    JSON.stringify({ publicKey, privateKey, algorithm: 'ed25519', createdAt: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 },
  );

  console.log('✅  Generated ed25519 Casper testnet signer.');
  console.log('    Public key :', publicKey);
  console.log('    PEM file   :', PEM_PATH);
  console.log('    JSON file  :', JSON_PATH);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Fund the public key from the faucet: https://testnet.cspr.live/tools/faucet?account=${publicKey}`);
  console.log('  2. Copy the private key into backend/.env:');
  console.log(`     CASPER_SECRET_KEY=${privateKey}`);
  console.log('  3. Deploy the Odra contracts:');
  console.log('     cd contract && node scripts/deploy.js');
}

try {
  main();
} catch (err) {
  console.error('❌  Key generation failed:', err.message);
  process.exit(1);
}

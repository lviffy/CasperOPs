#!/usr/bin/env node
/**
 * BlockOps Casper Testnet End-to-End Agent Flow
 *
 * Executes the canonical agent lifecycle against a live Casper testnet:
 *   1. register_agent         (AgentFactory)
 *   2. attest_agent           (Reputation)
 *   3. get_reputation         (Reputation, view)
 *   4. escrow_deposit         (Escrow)
 *   5. escrow_payout          (Escrow)
 *   6. final state check      (CSPR.cloud)
 *
 * Required contract hashes are passed via flags. Deploys are signed with the
 * secret key (ed25519 or secp256k1) and submitted via casper-js-sdk.
 *
 * Every step is appended to the log file (markdown) so the run becomes a
 * reproducible audit trail in docs/testnet-validation.md.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  DeployUtil,
  Keys,
  RuntimeArgs,
  CLValueBuilder,
  CLPublicKey,
  CLAccountHash,
} from "casper-js-sdk";

const args = parseArgs(process.argv.slice(2));

const RPC = args.rpc;
const CSPR_CLOUD = args["cspr-cloud"];
const FACTORY = args.factory;
const REPUTATION = args.reputation;
const ESCROW = args.escrow;
const COMPLIANCE = args.compliance;
const SECRET = args["secret-key"];
const LOG = args.log;

if (!RPC || !CSPR_CLOUD || !FACTORY || !REPUTATION || !ESCROW || !COMPLIANCE || !SECRET) {
  console.error("Missing one of: --rpc, --cspr-cloud, --factory, --reputation, --escrow, --compliance, --secret-key");
  process.exit(1);
}

const cleanSecret = SECRET.startsWith("0x") ? SECRET.slice(2) : SECRET;
const secretBytes = Buffer.from(cleanSecret, "hex");
let keys;
if (secretBytes.length === 32) {
  // Could be ed25519 OR secp256k1; try ed25519 first, fall back to secp256k1.
  try {
    keys = Keys.Ed25519.loadKeyPairFromPrivateKey(secretBytes);
    if (!keys.publicKey.isEd25519()) throw new Error("not ed25519");
  } catch {
    keys = Keys.Secp256K1.loadKeyPairFromPrivateKey(secretBytes);
  }
} else {
  throw new Error(`Unsupported secret key length: ${secretBytes.length} bytes`);
}

const ALGO = keys.publicKey.isEd25519() ? "ed25519" : "secp256k1";
const DEPLOYER = keys.publicKey.toHex();

const logBuffer = [];
function log(line = "") {
  const ts = new Date().toISOString();
  const out = `${ts}  ${line}`;
  console.log(out);
  logBuffer.push(out);
}

function flush() {
  if (!LOG) return;
  const dir = path.dirname(LOG);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG, logBuffer.join("\n") + "\n");
  logBuffer.length = 0;
}

async function rpc(method, params = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function waitForDeploy(hash, label) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const result = await rpc("info_get_deploy", { deploy_hash: hash });
      const exec = result?.execution_results?.[0];
      if (exec) {
        const ok = !exec.error_message;
        log(`  ⏳  ${label} ${hash} → ${ok ? "✅ executed" : "❌ " + exec.error_message}`);
        return ok;
      }
    } catch (err) {
      // not yet indexed
    }
    await sleep(2000);
  }
  log(`  ⚠️  ${label} ${hash} still pending after 120s`);
  return false;
}

function buildDeploy({ hash, entryPoint, args, paymentMotes = 50_000_000_000 }) {
  const params = new DeployUtil.DeployParams(keys.publicKey, "casper-test");
  const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
    Uint8Array.from(Buffer.from(hash.replace(/^hash-/, ""), "hex")),
    entryPoint,
    RuntimeArgs.fromMap(args),
  );
  const pmt = DeployUtil.standardPayment(paymentMotes);
  return DeployUtil.signDeploy(DeployUtil.makeDeploy(params, session, pmt), keys);
}

async function sendDeploy({ hash, entryPoint, args, label, paymentMotes }) {
  const signed = buildDeploy({ hash, entryPoint, args, paymentMotes });
  const json = DeployUtil.deployToJson(signed);
  const result = await rpc("account_put_deploy", json);
  log(`  📤  ${label} submitted: ${result.deploy_hash}`);
  await waitForDeploy(result.deploy_hash, label);
  return result.deploy_hash;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur.startsWith("--")) {
      const key = cur.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function normalizeHash(input) {
  if (!input) return null;
  const stripped = input.startsWith("hash-") ? input.slice(5) : input.startsWith("0x") ? input.slice(2) : input;
  if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error(`Invalid contract hash: ${input}`);
  }
  return `hash-${stripped.toLowerCase()}`;
}

(async () => {
  log(`# BlockOps Testnet End-to-End Run`);
  log(`Deployer: \`${DEPLOYER}\` (${ALGO})`);
  log(`RPC: ${RPC}`);
  log(`CSPR.cloud: ${CSPR_CLOUD}`);
  log(`Factory:   ${FACTORY}`);
  log(`Reputation: ${REPUTATION}`);
  log(`Escrow:    ${ESCROW}`);
  log(`Compliance: ${COMPLIANCE}`);
  log("");

  const factoryHash = normalizeHash(FACTORY);
  const reputationHash = normalizeHash(REPUTATION);
  const escrowHash = normalizeHash(ESCROW);

  // 1. register_agent
  log("## 1. register_agent");
  const agentId = `agent-${Date.now()}`;
  const registerArgs = {
    agent_id: CLValueBuilder.string(agentId),
    metadata_uri: CLValueBuilder.string("ipfs://blockops/test/metadata.json"),
    owner: CLValueBuilder.key(keys.publicKey),
  };
  await sendDeploy({
    hash: factoryHash,
    entryPoint: "register_agent",
    args: registerArgs,
    label: `register_agent(${agentId})`,
  });
  log("");

  // 2. attest_agent
  log("## 2. attest_agent");
  const attestArgs = {
    agent_id: CLValueBuilder.string(agentId),
    score: CLValueBuilder.u8(85),
    evidence_uri: CLValueBuilder.string("ipfs://blockops/test/attestation.json"),
    attester: CLValueBuilder.key(keys.publicKey),
  };
  await sendDeploy({
    hash: reputationHash,
    entryPoint: "attest_agent",
    args: attestArgs,
    label: `attest_agent(${agentId},85)`,
  });
  log("");

  // 3. get_reputation (view)
  log("## 3. get_reputation (view)");
  try {
    const result = await rpc("query_global_state", {
      key: REPUTATION,
      path: [`reputation_${agentId.replace(/-/g, "_")}`],
    });
    log(`  📊  ${JSON.stringify(result?.stored_value?.CLValue ?? result)}`);
  } catch (err) {
    log(`  ⚠️  Reputation lookup failed: ${err.message}`);
  }
  log("");

  // 4. escrow_deposit
  log("## 4. escrow_deposit");
  const depositArgs = {
    agent_id: CLValueBuilder.string(agentId),
    amount: CLValueBuilder.u512("1000000000"), // 1 CSPR
    depositor: CLValueBuilder.key(keys.publicKey),
  };
  await sendDeploy({
    hash: escrowHash,
    entryPoint: "deposit",
    args: depositArgs,
    label: `escrow_deposit(${agentId},1.0 CSPR)`,
  });
  log("");

  // 5. escrow_payout
  log("## 5. escrow_payout");
  const payoutArgs = {
    agent_id: CLValueBuilder.string(agentId),
    recipient: CLValueBuilder.key(keys.publicKey),
  };
  await sendDeploy({
    hash: escrowHash,
    entryPoint: "payout",
    args: payoutArgs,
    label: `escrow_payout(${agentId})`,
  });
  log("");

  // 6. final state check via CSPR.cloud
  log("## 6. Final state check (CSPR.cloud)");
  try {
    const res = await fetch(`${CSPR_CLOUD.replace(/\/$/, "")}/accounts/${DEPLOYER}/balance`);
    if (res.ok) {
      const json = await res.json();
      log(`  💰  Deployer balance: ${JSON.stringify(json)}`);
    } else {
      log(`  ⚠️  CSPR.cloud balance lookup HTTP ${res.status}`);
    }
  } catch (err) {
    log(`  ⚠️  CSPR.cloud check failed: ${err.message}`);
  }
  log("");
  log(`Run finished.`);
  flush();
})().catch((err) => {
  log(`❌  Run aborted: ${err.message}`);
  flush();
  process.exit(1);
});

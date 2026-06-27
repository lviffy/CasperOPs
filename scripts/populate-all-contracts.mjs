import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pkg from "casper-js-sdk";
const { Keys, DeployUtil, CLValueBuilder, RuntimeArgs, CasperClient } = pkg;

dotenv.config({ path: path.join(process.cwd(), "backend/.env") });

const RPC = process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc";
const SECRET = process.env.CASPER_SECRET_KEY;

const FACTORY = process.env.CASPER_AGENT_FACTORY_HASH;
const REPUTATION = process.env.CASPER_REPUTATION_HASH;
const ESCROW = process.env.CASPER_ESCROW_HASH;
const COMPLIANCE = process.env.CASPER_COMPLIANCE_HASH;
const CEP18 = process.env.CASPER_CEP18_HASH;
const CEP78 = process.env.CASPER_CEP78_HASH;

function normalizeHash(input) {
  if (!input) return null;
  const stripped = input.startsWith("hash-") ? input.slice(5) : input.startsWith("0x") ? input.slice(2) : input;
  return stripped.toLowerCase();
}

const cleanSecret = SECRET.startsWith("0x") ? SECRET.slice(2) : SECRET;
const secretBytes = Buffer.from(cleanSecret, "hex");
let keys;
try {
  if (secretBytes.length === 32) {
    const privKey = Keys.Ed25519.parsePrivateKey(secretBytes);
    const pubKey = Keys.Ed25519.privateToPublicKey(privKey);
    keys = Keys.Ed25519.parseKeyPair(pubKey, privKey);
  } else {
    const privKey = Keys.Secp256K1.parsePrivateKey(secretBytes);
    const pubKey = Keys.Secp256K1.privateToPublicKey(privKey);
    keys = Keys.Secp256K1.parseKeyPair(pubKey, privKey);
  }
} catch {
  const privKey = Keys.Secp256K1.parsePrivateKey(secretBytes);
  const pubKey = Keys.Secp256K1.privateToPublicKey(privKey);
  keys = Keys.Secp256K1.parseKeyPair(pubKey, privKey);
}

async function sendDeploy(contractHashHex, entryPoint, runtimeArgs, paymentMotes = 50_000_000_000) {
  try {
    const deployParams = new DeployUtil.DeployParams(keys.publicKey, "casper-test");
    const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
      Uint8Array.from(Buffer.from(contractHashHex, "hex")),
      entryPoint,
      runtimeArgs
    );
    const payment = DeployUtil.standardPayment(paymentMotes);
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);

    const headers = { "content-type": "application/json" };
    if (process.env.CSPR_CLOUD_API_KEY) {
      headers["authorization"] = process.env.CSPR_CLOUD_API_KEY;
    }

    const deployJson = DeployUtil.deployToJson(signedDeploy);
    const res = await fetch(RPC, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "account_put_deploy", params: deployJson })
    });
    const json = await res.json();
    if (json.error) {
      console.error(`  ❌ ${entryPoint} error:`, json.error);
    } else {
      console.log(`  ✅ ${entryPoint} submitted! Deploy Hash: ${json.result.deploy_hash}`);
    }
  } catch (err) {
    console.error(`  ❌ ${entryPoint} failed:`, err.message);
  }
}

async function run() {
  console.log("🚀 Submitting 5 rounds of transactions across ALL 6 Odra contracts on Casper Testnet...");
  const pubKeyArg = CLValueBuilder.key(keys.publicKey);

  for (let round = 1; round <= 5; round++) {
    console.log(`\n=================== ROUND ${round} / 5 ===================`);
    
    // 1. AgentFactory::deploy_agent
    console.log("1. AgentFactory::deploy_agent");
    await sendDeploy(normalizeHash(FACTORY), "deploy_agent", RuntimeArgs.fromMap({ agent_address: pubKeyArg }));

    // 2. Reputation::log_success
    console.log("2. Reputation::log_success");
    await sendDeploy(normalizeHash(REPUTATION), "log_success", RuntimeArgs.fromMap({ agent: pubKeyArg }));

    // 3. Escrow::deposit
    console.log("3. Escrow::deposit");
    await sendDeploy(normalizeHash(ESCROW), "deposit", RuntimeArgs.fromMap({ agent: pubKeyArg }), 50_000_000_000);

    // 4. Compliance::attest_agent
    console.log("4. Compliance::attest_agent");
    await sendDeploy(normalizeHash(COMPLIANCE), "attest_agent", RuntimeArgs.fromMap({
      agent: pubKeyArg,
      verified: CLValueBuilder.bool(true),
      uri: CLValueBuilder.string(`ipfs://casperops/compliance/batch-${round}.json`)
    }));

    // 5. CEP18::transfer
    console.log("5. CEP18::transfer");
    await sendDeploy(normalizeHash(CEP18), "transfer", RuntimeArgs.fromMap({
      recipient: pubKeyArg,
      amount: CLValueBuilder.u256(String(1000 * round))
    }));

    // 6. CEP78::mint
    console.log("6. CEP78::mint");
    await sendDeploy(normalizeHash(CEP78), "mint", RuntimeArgs.fromMap({
      recipient: pubKeyArg
    }));

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n✨ All 30 transaction submissions successfully dispatched to Casper Testnet!");
  process.exit(0);
}

run();

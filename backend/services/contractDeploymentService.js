/**
 * Casper CEP-18 Token & CEP-78 NFT deployment service.
 * Replaces the old Solidity/solc contract compilation service.
 *
 * CEP-18 = Casper Fungible Token standard (ERC-20 equivalent)
 * CEP-78 = Casper NFT standard (ERC-721 equivalent)
 *
 * NOTE: Actual WASM deployment requires compiled Odra contract WASM binaries.
 * The WASM paths below point to the expected build output from:
 *   cd contract && cargo odra build
 */

const fs = require('fs');
const path = require('path');
const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder, CLPublicKey } = require('casper-js-sdk');
const { getClient, getKeysFromHex } = require('../utils/blockchain');
const { getChainMetadata } = require('../utils/chains');
const { logger } = require('../utils/logger');

const log = logger.child({ component: 'contractDeploymentService' });

// Expected WASM binary paths after `cargo odra build`
const WASM_DIR = path.resolve(__dirname, '../../contract/wasm');
const CEP18_WASM = path.join(WASM_DIR, 'Cep18Token.wasm');
const CEP78_WASM = path.join(WASM_DIR, 'Cep78Nft.wasm');

// CEP-18 deploy payment (200 CSPR in motes)
const CEP18_PAYMENT_MOTES = 200_000_000_000;
// CEP-78 deploy payment (500 CSPR — higher because the contract stores more
// state at init)
const CEP78_PAYMENT_MOTES = 500_000_000_000;

// CEP-78 mode flags — exported so tests can assert stability across edits.
const CEP78_OWNERSHIP_MODE_TRANSFERABLE = 2;
const CEP78_NFT_KIND_DIGITAL = 1;
const CEP78_METADATA_KIND_CEP78 = 0;
const CEP78_IDENTIFIER_MODE_ORDINAL = 0;
const CEP78_METADATA_IMMUTABLE = 0;

function loadWasm(wasmPath) {
  if (!fs.existsSync(wasmPath)) {
    log.error({ wasmPath }, 'WASM binary missing — run `cargo odra build`');
    throw new Error(
      `WASM binary not found at ${wasmPath}. ` +
      `Run: cd contract && cargo odra build`
    );
  }
  return new Uint8Array(fs.readFileSync(wasmPath));
}

/**
 * Pure helper: build the CEP-18 init-args map for `RuntimeArgs.fromMap`.
 * Exported so tests can assert on the arg shape without mocking the SDK.
 */
function buildCep18InitArgs({ name, symbol, decimals = 9, totalSupply }) {
  return {
    name: CLValueBuilder.string(name),
    symbol: CLValueBuilder.string(symbol),
    decimals: CLValueBuilder.u8(Number(decimals)),
    total_supply: CLValueBuilder.u256(String(totalSupply)),
    odra_cfg_package_hash_key_name: CLValueBuilder.string(`cep18_${symbol.toLowerCase()}`),
    odra_cfg_allow_key_override: CLValueBuilder.bool(true),
    odra_cfg_is_upgradable: CLValueBuilder.bool(false),
    odra_cfg_is_upgrade: CLValueBuilder.bool(false),
    odra_cfg_constructor: CLValueBuilder.string('init'),
  };
}

/**
 * Pure helper: build the CEP-78 init-args map for `RuntimeArgs.fromMap`.
 * Exported so tests can assert on the arg shape without mocking the SDK.
 */
function buildCep78InitArgs({ name, symbol, totalTokenSupply = 1000, minter }) {
  const args = {
    collection_name: CLValueBuilder.string(name),
    collection_symbol: CLValueBuilder.string(symbol),
    total_token_supply: CLValueBuilder.u64(totalTokenSupply),
    odra_cfg_package_hash_key_name: CLValueBuilder.string(`cep78_${symbol.toLowerCase()}`),
    odra_cfg_allow_key_override: CLValueBuilder.bool(true),
    odra_cfg_is_upgradable: CLValueBuilder.bool(false),
    odra_cfg_is_upgrade: CLValueBuilder.bool(false),
    odra_cfg_constructor: CLValueBuilder.string('init'),
  };

  if (minter) {
    args.minter = minter instanceof CLPublicKey ? CLValueBuilder.key(minter) : minter;
  }

  return args;
}

/**
 * Deploy a CEP-18 fungible token (equivalent to ERC-20) on Casper Testnet.
 */
async function deployCep18Token({ privateKey, name, symbol, decimals = 9, totalSupply }) {
  const keys = getKeysFromHex(privateKey);
  if (!keys) {
    log.warn({ standard: 'CEP-18', reason: 'invalid_key' }, 'deploy rejected: invalid private key');
    throw new Error('Invalid private key format.');
  }

  const wasm = loadWasm(CEP18_WASM);
  const client = getClient();

  const deployParams = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');
  const args = RuntimeArgs.fromMap(buildCep18InitArgs({ name, symbol, decimals, totalSupply }));
  const payment = DeployUtil.standardPayment(CEP18_PAYMENT_MOTES);
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, args);
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
  const signedDeploy = DeployUtil.signDeploy(deploy, keys);
  log.info({
    standard: 'CEP-18',
    name,
    symbol,
    decimals,
    totalSupply: String(totalSupply),
    paymentMotes: CEP18_PAYMENT_MOTES,
    deployer: keys.publicKey.toHex(),
  }, 'submitting CEP-18 token deploy');
  const deployHash = await client.deploy(signedDeploy);
  log.info({ standard: 'CEP-18', deployHash }, 'CEP-18 token deploy submitted');

  return {
    ...getChainMetadata(),
    message: 'CEP-18 token deploy submitted successfully',
    standard: 'CEP-18',
    transactionHash: deployHash,
    tokenInfo: { name, symbol, decimals, totalSupply },
    explorerUrl: `https://testnet.cspr.live/deploy/${deployHash}`,
  };
}

/**
 * Deploy a CEP-78 NFT collection (equivalent to ERC-721) on Casper Testnet.
 */
async function deployCep78Collection({ privateKey, name, symbol, totalTokenSupply = 1000 }) {
  const keys = getKeysFromHex(privateKey);
  if (!keys) {
    log.warn({ standard: 'CEP-78', reason: 'invalid_key' }, 'deploy rejected: invalid private key');
    throw new Error('Invalid private key format.');
  }

  const wasm = loadWasm(CEP78_WASM);
  const client = getClient();

  const deployParams = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');
  const args = RuntimeArgs.fromMap(
    buildCep78InitArgs({ name, symbol, totalTokenSupply, minter: keys.publicKey })
  );
  const payment = DeployUtil.standardPayment(CEP78_PAYMENT_MOTES);
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, args);
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
  const signedDeploy = DeployUtil.signDeploy(deploy, keys);
  log.info({
    standard: 'CEP-78',
    name,
    symbol,
    totalTokenSupply,
    paymentMotes: CEP78_PAYMENT_MOTES,
    deployer: keys.publicKey.toHex(),
  }, 'submitting CEP-78 collection deploy');
  const deployHash = await client.deploy(signedDeploy);
  log.info({ standard: 'CEP-78', deployHash }, 'CEP-78 collection deploy submitted');

  return {
    ...getChainMetadata(),
    message: 'CEP-78 NFT collection deploy submitted successfully',
    standard: 'CEP-78',
    transactionHash: deployHash,
    collectionInfo: { name, symbol, totalTokenSupply },
    explorerUrl: `https://testnet.cspr.live/deploy/${deployHash}`,
  };
}

module.exports = {
  deployCep18Token,
  deployCep78Collection,
  // Pure helpers exposed for unit tests; the deploy helpers above delegate
  // here so test coverage is one-to-one with production.
  buildCep18InitArgs,
  buildCep78InitArgs,
  // Constants exposed for tests + downstream callers that want to know the
  // payment amount without reading source.
  CEP18_PAYMENT_MOTES,
  CEP78_PAYMENT_MOTES,
  CEP18_WASM,
  CEP78_WASM,
  // Re-exported so tests can introspect the mode flags.
  CEP78_OWNERSHIP_MODE_TRANSFERABLE,
  CEP78_NFT_KIND_DIGITAL,
  CEP78_METADATA_KIND_CEP78,
  CEP78_IDENTIFIER_MODE_ORDINAL,
  CEP78_METADATA_IMMUTABLE,
};

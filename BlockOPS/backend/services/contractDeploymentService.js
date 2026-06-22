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
const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder } = require('casper-js-sdk');
const { getClient, getKeysFromHex } = require('../utils/blockchain');
const { getChainMetadata } = require('../utils/chains');

// Expected WASM binary paths after `cargo odra build`
const WASM_DIR = path.resolve(__dirname, '../../contract/target/wasm32-unknown-unknown/release');
const CEP18_WASM = path.join(WASM_DIR, 'blockops_contracts_cep18.wasm');
const CEP78_WASM = path.join(WASM_DIR, 'blockops_contracts_cep78.wasm');

function loadWasm(wasmPath) {
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `WASM binary not found at ${wasmPath}. ` +
      `Run: cd contract && cargo odra build`
    );
  }
  return new Uint8Array(fs.readFileSync(wasmPath));
}

/**
 * Deploy a CEP-18 fungible token (equivalent to ERC-20) on Casper Testnet.
 */
async function deployCep18Token({ privateKey, name, symbol, decimals = 9, totalSupply }) {
  const keys = getKeysFromHex(privateKey);
  if (!keys) throw new Error('Invalid private key format.');

  const wasm = loadWasm(CEP18_WASM);
  const client = getClient();

  const deployParams = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');

  const args = RuntimeArgs.fromMap({
    name: CLValueBuilder.string(name),
    symbol: CLValueBuilder.string(symbol),
    decimals: CLValueBuilder.u8(decimals),
    total_supply: CLValueBuilder.u256(String(totalSupply)),
  });

  const payment = DeployUtil.standardPayment(200_000_000_000); // 200 CSPR
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, args);
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
  const signedDeploy = DeployUtil.signDeploy(deploy, keys);
  const deployHash = await client.deploy(signedDeploy);

  return {
    ...getChainMetadata(),
    message: 'CEP-18 token deploy submitted successfully',
    standard: 'CEP-18',
    transactionHash: deployHash,
    tokenInfo: { name, symbol, decimals, totalSupply },
    explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`,
  };
}

/**
 * Deploy a CEP-78 NFT collection (equivalent to ERC-721) on Casper Testnet.
 */
async function deployCep78Collection({ privateKey, name, symbol, totalTokenSupply = 1000 }) {
  const keys = getKeysFromHex(privateKey);
  if (!keys) throw new Error('Invalid private key format.');

  const wasm = loadWasm(CEP78_WASM);
  const client = getClient();

  const deployParams = new DeployUtil.DeployParams(keys.publicKey, 'casper-test');

  const args = RuntimeArgs.fromMap({
    collection_name: CLValueBuilder.string(name),
    collection_symbol: CLValueBuilder.string(symbol),
    total_token_supply: CLValueBuilder.u64(totalTokenSupply),
    ownership_mode: CLValueBuilder.u8(2), // Transferable
    nft_kind: CLValueBuilder.u8(1),       // Digital
    nft_metadata_kind: CLValueBuilder.u8(0), // CEP-78 standard metadata
    identifier_mode: CLValueBuilder.u8(0),   // Ordinal (numeric)
    metadata_mutability: CLValueBuilder.u8(0), // Immutable
  });

  const payment = DeployUtil.standardPayment(500_000_000_000); // 500 CSPR
  const session = DeployUtil.ExecutableDeployItem.newModuleBytes(wasm, args);
  const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
  const signedDeploy = DeployUtil.signDeploy(deploy, keys);
  const deployHash = await client.deploy(signedDeploy);

  return {
    ...getChainMetadata(),
    message: 'CEP-78 NFT collection deploy submitted successfully',
    standard: 'CEP-78',
    transactionHash: deployHash,
    collectionInfo: { name, symbol, totalTokenSupply },
    explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`,
  };
}

module.exports = {
  deployCep18Token,
  deployCep78Collection,
};

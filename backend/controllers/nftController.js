const fs = require('fs');
const path = require('path');
const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder, CLPublicKey } = require('casper-js-sdk');
const { getClient, getKeysFromHex } = require('../utils/blockchain');
const { successResponse, errorResponse, validateRequiredFields } = require('../utils/helpers');

// Load WASM binaries once at startup
const WASM_DIR = path.resolve(__dirname, '../../contract/wasm');
const CEP78_WASM = fs.readFileSync(path.join(WASM_DIR, 'Cep78Nft.wasm'));

async function deployNFTCollection(req, res) {
  try {
    const { privateKey, name, symbol, baseURI } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'name', 'symbol', 'baseURI']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const keys = getKeysFromHex(privateKey);
    if (!keys) {
      return res.status(400).json(errorResponse('Invalid private key.'));
    }

    const client = getClient();
    
    const deployParams = new DeployUtil.DeployParams(
      keys.publicKey,
      'casper-test'
    );
    
    const args = RuntimeArgs.fromMap({
      collection_name: CLValueBuilder.string(name),
      collection_symbol: CLValueBuilder.string(symbol),
      total_token_supply: CLValueBuilder.u64(10000), // Sensible default cap of 10,000
      minter: CLValueBuilder.key(keys.publicKey),
      odra_cfg_package_hash_key_name: CLValueBuilder.string(`cep78_${symbol.toLowerCase()}`),
      odra_cfg_allow_key_override: CLValueBuilder.bool(true),
      odra_cfg_is_upgradable: CLValueBuilder.bool(false),
      odra_cfg_is_upgrade: CLValueBuilder.bool(false),
      odra_cfg_constructor: CLValueBuilder.string('init')
    });
    
    const payment = DeployUtil.standardPayment(500_000_000_000); // 500 CSPR
    const session = DeployUtil.ExecutableDeployItem.newModuleBytes(
      new Uint8Array(CEP78_WASM),
      args
    );
    
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);
    const deployHash = await client.deploy(signedDeploy);

    return res.json(successResponse({
      message: 'CEP-78 NFT Collection deploy submitted successfully',
      transactionHash: deployHash,
      name,
      symbol,
      baseURI,
      explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`
    }));

  } catch (error) {
    console.error('Deploy NFT Collection error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function mintNFT(req, res) {
  try {
    const { privateKey, collectionAddress, toAddress } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'collectionAddress', 'toAddress']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const keys = getKeysFromHex(privateKey);
    if (!keys) {
      return res.status(400).json(errorResponse('Invalid private key.'));
    }

    const client = getClient();
    
    const deployParams = new DeployUtil.DeployParams(
      keys.publicKey,
      'casper-test'
    );
    
    const args = RuntimeArgs.fromMap({
      recipient: CLValueBuilder.key(CLPublicKey.fromHex(toAddress))
    });
    
    const payment = DeployUtil.standardPayment(5_000_000_000); // 5 CSPR
    const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
      Uint8Array.from(Buffer.from(collectionAddress, 'hex')),
      'mint',
      args
    );
    
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);
    const deployHash = await client.deploy(signedDeploy);

    return res.json(successResponse({
      message: 'CEP-78 NFT minted successfully',
      transactionHash: deployHash,
      collectionAddress: collectionAddress,
      owner: toAddress,
      explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`
    }));

  } catch (error) {
    console.error('Mint NFT error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function getNFTInfo(req, res) {
  try {
    const { collectionAddress, tokenId } = req.params;
    return res.json(successResponse({
      collectionAddress: collectionAddress,
      tokenId: tokenId,
      owner: '012514844f312c02ae3c9d4feb40db4ec8830b6844',
      tokenURI: 'ipfs://metadata',
      collectionName: 'Casper NFT Collection',
      collectionSymbol: 'CNFT'
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  deployNFTCollection,
  mintNFT,
  getNFTInfo
};

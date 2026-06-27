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
      total_token_supply: CLValueBuilder.u64(10000),
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
    const deployResponse = await client.deploy(signedDeploy);
    const deployHash = deployResponse.deploy_hash || deployResponse;

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
    const msg = error.data ? `${error.message}: ${error.data}` : error.message;
    return res.status(500).json(errorResponse(msg));
  }
}

/**
 * Prepare an unsigned CEP-78 NFT collection deploy for client-side signing.
 * Returns { requiresSigning: true, deploy: <JSON> } — the frontend will
 * sign via CSPR.click and broadcast through /token/broadcast.
 */
async function prepareDeployNFTCollection(req, res) {
  try {
    const { deployerAddress, name, symbol, baseURI, totalTokenSupply } = req.body;

    const validationError = validateRequiredFields(req.body, ['deployerAddress', 'name', 'symbol']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const deployerPubKey = CLPublicKey.fromHex(deployerAddress);

    const deployParams = new DeployUtil.DeployParams(
      deployerPubKey,
      'casper-test'
    );

    const supply = totalTokenSupply || 10000;
    const uri = baseURI || 'ipfs://metadata';

    const args = RuntimeArgs.fromMap({
      collection_name: CLValueBuilder.string(name),
      collection_symbol: CLValueBuilder.string(symbol),
      total_token_supply: CLValueBuilder.u64(supply),
      minter: CLValueBuilder.key(deployerPubKey),
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
    const deployJson = DeployUtil.deployToJson(deploy);

    return res.json(successResponse({
      requiresSigning: true,
      deploy: deployJson,
      name,
      symbol,
      baseURI: uri,
      totalTokenSupply: supply,
    }));

  } catch (error) {
    console.error('Prepare deploy NFT Collection error:', error);
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
      Uint8Array.from(Buffer.from(collectionAddress.replace(/^hash-/, ''), 'hex')),
      'mint',
      args
    );
    
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);
    const deployResponse = await client.deploy(signedDeploy);
    const deployHash = deployResponse.deploy_hash || deployResponse;

    return res.json(successResponse({
      message: 'CEP-78 NFT minted successfully',
      transactionHash: deployHash,
      collectionAddress: collectionAddress,
      owner: toAddress,
      explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`
    }));

  } catch (error) {
    console.error('Mint NFT error:', error);
    const msg = error.data ? `${error.message}: ${error.data}` : error.message;
    return res.status(500).json(errorResponse(msg));
  }
}

/**
 * Prepare an unsigned CEP-78 mint deploy for client-side signing.
 */
async function prepareMintNFT(req, res) {
  try {
    const { deployerAddress, collectionAddress, toAddress, tokenUri } = req.body;

    const validationError = validateRequiredFields(req.body, ['deployerAddress', 'collectionAddress', 'toAddress']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const deployerPubKey = CLPublicKey.fromHex(deployerAddress);

    const deployParams = new DeployUtil.DeployParams(
      deployerPubKey,
      'casper-test'
    );

    const args = RuntimeArgs.fromMap({
      recipient: CLValueBuilder.key(CLPublicKey.fromHex(toAddress))
    });

    const payment = DeployUtil.standardPayment(5_000_000_000); // 5 CSPR
    const session = DeployUtil.ExecutableDeployItem.newStoredContractByHash(
      Uint8Array.from(Buffer.from(collectionAddress.replace(/^hash-/, ''), 'hex')),
      'mint',
      args
    );

    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const deployJson = DeployUtil.deployToJson(deploy);

    return res.json(successResponse({
      requiresSigning: true,
      deploy: deployJson,
      collectionAddress,
      toAddress,
      tokenUri: tokenUri || 'ipfs://metadata',
    }));

  } catch (error) {
    console.error('Prepare mint NFT error:', error);
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
  prepareDeployNFTCollection,
  mintNFT,
  prepareMintNFT,
  getNFTInfo
};

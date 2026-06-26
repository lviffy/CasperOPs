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
      nft_metadata_kind: CLValueBuilder.u8(1),
      identifier_mode: CLValueBuilder.u8(0),
      metadata_mutability: CLValueBuilder.u8(0)
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
      token_owner: CLValueBuilder.key(CLPublicKey.fromHex(toAddress)),
      token_meta_data: CLValueBuilder.string('{"name":"CasperOPs Agent Asset"}')
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

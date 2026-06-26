const fs = require('fs');
const path = require('path');
const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder, CLPublicKey } = require('casper-js-sdk');
const { getClient, getKeysFromHex, getAccountBalance, sendDeploy } = require('../utils/blockchain');
const { successResponse, errorResponse, validateRequiredFields } = require('../utils/helpers');

// Load WASM binaries once at startup
const WASM_DIR = path.resolve(__dirname, '../../contract/wasm');
const CEP18_WASM = fs.readFileSync(path.join(WASM_DIR, 'Cep18Token.wasm'));
const CEP78_WASM = fs.readFileSync(path.join(WASM_DIR, 'Cep78Nft.wasm'));

async function deployToken(req, res) {
  try {
    const { privateKey, name, symbol, initialSupply, decimals = 9 } = req.body;

    const validationError = validateRequiredFields(req.body, ['privateKey', 'name', 'symbol', 'initialSupply']);
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
      name: CLValueBuilder.string(name),
      symbol: CLValueBuilder.string(symbol),
      decimals: CLValueBuilder.u8(decimals),
      total_supply: CLValueBuilder.u256(initialSupply)
    });
    
    const payment = DeployUtil.standardPayment(200_000_000_000); // 200 CSPR
    const session = DeployUtil.ExecutableDeployItem.newModuleBytes(
      new Uint8Array(CEP18_WASM),
      args
    );
    
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);
    const deployHash = await client.deploy(signedDeploy);

    return res.json(successResponse({
      message: 'CEP-18 Token deploy submitted successfully',
      transactionHash: deployHash,
      name,
      symbol,
      decimals,
      initialSupply,
      explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`
    }));

  } catch (error) {
    console.error('Deploy token error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function getTokenInfo(req, res) {
  try {
    const { tokenId } = req.params;
    return res.json(successResponse({
      tokenId: tokenId,
      name: 'Casper Standard Token',
      symbol: 'CST',
      decimals: 9,
      totalSupply: '1000000',
      explorerUrl: `https://testnet.casper.live/contract/${tokenId}`
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

async function getTokenBalance(req, res) {
  try {
    const { tokenId, ownerAddress } = req.params;
    return res.json(successResponse({
      tokenId: tokenId,
      ownerAddress: ownerAddress,
      balance: '5000',
      decimals: 9
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

async function prepareDeployToken(req, res) {
  try {
    const { deployerAddress, name, symbol, initialSupply, decimals = 9 } = req.body;

    const validationError = validateRequiredFields(req.body, ['deployerAddress', 'name', 'symbol', 'initialSupply']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const deployParams = new DeployUtil.DeployParams(
      CLPublicKey.fromHex(deployerAddress),
      'casper-test'
    );
    
    const args = RuntimeArgs.fromMap({
      name: CLValueBuilder.string(name),
      symbol: CLValueBuilder.string(symbol),
      decimals: CLValueBuilder.u8(decimals),
      total_supply: CLValueBuilder.u256(initialSupply)
    });
    
    const payment = DeployUtil.standardPayment(200_000_000_000); // 200 CSPR
    const session = DeployUtil.ExecutableDeployItem.newModuleBytes(
      new Uint8Array(CEP18_WASM),
      args
    );
    
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const deployJson = DeployUtil.deployToJson(deploy);

    return res.json(successResponse({
      requiresSigning: true,
      deploy: deployJson,
      name,
      symbol,
      decimals,
      initialSupply,
    }));

  } catch (error) {
    console.error('Prepare deploy token error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function broadcastDeploy(req, res) {
  try {
    const { signedDeploy } = req.body;
    if (!signedDeploy) {
      return res.status(400).json(errorResponse('Missing signedDeploy in request body.'));
    }

    const { DeployUtil } = require('casper-js-sdk');
    const result = DeployUtil.deployFromJson(signedDeploy);
    let deploy;
    if (result && typeof result.unwrap === 'function') {
      deploy = result.unwrap();
    } else {
      deploy = result;
    }

    if (!deploy) {
      return res.status(400).json(errorResponse('Failed to parse signed deploy JSON.'));
    }

    const deployHash = await sendDeploy(deploy);
    return res.json(successResponse({
      message: 'Deploy broadcasted successfully through backend relay',
      deployHash,
      transactionHash: deployHash,
    }));
  } catch (error) {
    console.error('Broadcast deploy error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  deployToken,
  prepareDeployToken,
  getTokenInfo,
  getTokenBalance,
  broadcastDeploy
};

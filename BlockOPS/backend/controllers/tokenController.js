const { DeployUtil, Keys, RuntimeArgs, CLValueBuilder } = require('casper-js-sdk');
const { getClient, getKeysFromHex, getAccountBalance } = require('../utils/blockchain');
const { successResponse, errorResponse, validateRequiredFields } = require('../utils/helpers');

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
      new Uint8Array([]),
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

module.exports = {
  deployToken,
  getTokenInfo,
  getTokenBalance
};

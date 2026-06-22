const { DeployUtil, Keys } = require('casper-js-sdk');
const { getClient, getKeysFromHex, getAccountBalance } = require('../utils/blockchain');
const { successResponse, errorResponse, validateRequiredFields } = require('../utils/helpers');

async function transfer(req, res) {
  try {
    const { privateKey, toAddress, amount } = req.body;
    
    const validationError = validateRequiredFields(req.body, ['privateKey', 'toAddress', 'amount']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const keys = getKeysFromHex(privateKey);
    if (!keys) {
      return res.status(400).json(errorResponse('Invalid private key.'));
    }

    const client = getClient();
    const fromAddress = keys.publicKey.toHex();
    
    // Check balance
    const balanceMotes = await getAccountBalance(fromAddress);
    // 1 CSPR = 1,000,000,000 motes
    const amountInMotes = BigInt(Math.floor(Number(amount) * 1_000_000_000));
    
    if (BigInt(balanceMotes) < amountInMotes) {
      return res.status(400).json(errorResponse('Insufficient balance.', {
        balance: (Number(balanceMotes) / 1_000_000_000).toString(),
        required: amount.toString()
      }));
    }

    // Build deploy
    const deployParams = new DeployUtil.DeployParams(
      keys.publicKey,
      'casper-test'
    );
    
    const session = DeployUtil.ExecutableDeployItem.newTransfer(
      amountInMotes.toString(),
      Keys.PublicKey.fromHex(toAddress),
      undefined,
      12345
    );
    
    const payment = DeployUtil.standardPayment(100_000_000); // 0.1 CSPR
    const deploy = DeployUtil.makeDeploy(deployParams, session, payment);
    const signedDeploy = DeployUtil.signDeploy(deploy, keys);
    
    const deployHash = await client.deploy(signedDeploy);

    return res.json(successResponse({
      type: 'native',
      transactionHash: deployHash,
      from: fromAddress,
      to: toAddress,
      amount: amount,
      explorerUrl: `https://testnet.casper.live/deploy/${deployHash}`
    }));

  } catch (error) {
    console.error('Casper Transfer error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

async function getBalance(req, res) {
  try {
    const { address } = req.params;
    const balanceMotes = await getAccountBalance(address);
    const balanceCspr = (Number(balanceMotes) / 1_000_000_000).toString();
    
    return res.json(successResponse({
      address: address,
      balance: balanceCspr,
      balanceMotes: balanceMotes,
      network: 'Casper Testnet'
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

async function prepareTransfer(req, res) {
  try {
    const { fromAddress, toAddress, amount } = req.body;
    
    const validationError = validateRequiredFields(req.body, ['fromAddress', 'toAddress', 'amount']);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const amountInMotes = BigInt(Math.floor(Number(amount) * 1_000_000_000));
    
    return res.json(successResponse({
      type: 'native',
      requiresCsprClick: true,
      deployJson: {
        from: fromAddress,
        to: toAddress,
        amount: amountInMotes.toString(),
        payment: '100000000',
        network: 'casper-test'
      }
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  transfer,
  prepareTransfer,
  getBalance
};

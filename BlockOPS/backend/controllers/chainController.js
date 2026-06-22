/**
 * Chain Controller — on-chain history, lookup, and decode tools
 *
 * Endpoints:
 *   GET  /chain/tx/:hash              – transaction details + decoded input
 *   GET  /chain/tx/:hash/receipt      – full receipt + status
 *   GET  /chain/block/:number         – block info (latest if "latest")
 *   POST /chain/events                – fetch contract events via eth_getLogs
 *   POST /chain/decode/calldata       – decode calldata using an ABI
 *   POST /chain/decode/revert         – decode revert reason (hex → human-readable)
 *   GET  /chain/address/:address/txs  – recent transactions for an address (via Etherscan)
 */

const { ethers } = require('ethers');
const axios = require('axios');
const { getProvider } = require('../utils/blockchain');
const {
  successResponse,
  errorResponse,
  getTxExplorerUrl,
  getAddressExplorerUrl
} = require('../utils/helpers');
const {
  ETHERSCAN_V2_BASE_URL,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ETHERSCAN_API_KEY
} = require('../config/constants');
const {
  getChainFromRequest,
  getChainMetadata,
  isArbitrumChain
} = require('../utils/chains');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function etherscanRequest(params) {
  return axios.get(ETHERSCAN_V2_BASE_URL, {
    params: { chainid: ARBITRUM_SEPOLIA_CHAIN_ID, apikey: ETHERSCAN_API_KEY, ...params },
    timeout: 15000
  });
}

/** Try to decode a revert reason from raw return data bytes */
function decodeRevertBytes(data) {
  if (!data || data === '0x') return null;

  // Standard Error(string) selector: 0x08c379a0
  if (data.startsWith('0x08c379a0')) {
    try {
      const iface = new ethers.Interface(['function Error(string)']);
      const decoded = iface.decodeFunctionData('Error', data);
      return { type: 'Error', message: decoded[0] };
    } catch (_) {}
  }

  // Panic(uint256) selector: 0x4e487b71
  if (data.startsWith('0x4e487b71')) {
    try {
      const iface = new ethers.Interface(['function Panic(uint256)']);
      const decoded = iface.decodeFunctionData('Panic', data);
      const code = Number(decoded[0]);
      const PANIC_CODES = {
        0x00: 'Generic panic',
        0x01: 'Assertion failed',
        0x11: 'Arithmetic overflow/underflow',
        0x12: 'Division by zero',
        0x21: 'Invalid enum value',
        0x22: 'Invalid storage byte array',
        0x31: 'pop() on empty array',
        0x32: 'Array index out of bounds',
        0x41: 'Memory allocation failed (out of memory)',
        0x51: 'Called uninitialized internal function'
      };
      return { type: 'Panic', code: `0x${code.toString(16)}`, message: PANIC_CODES[code] || `Unknown panic code: 0x${code.toString(16)}` };
    } catch (_) {}
  }

  // Try to read as UTF-8 (some contracts revert with raw strings)
  try {
    const bytes = ethers.getBytes(data);
    const text = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
    if (text.length > 0 && text.length < 500 && /^[\x20-\x7E\n\r\t]+$/.test(text)) {
      return { type: 'RawString', message: text };
    }
  } catch (_) {}

  // Unknown selector — return raw
  return { type: 'UnknownSelector', selector: data.slice(0, 10), raw: data };
}

// ─── GET /chain/tx/:hash ──────────────────────────────────────────────────────
async function getTransaction(req, res) {
  try {
    const { hash } = req.params;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);
    if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      return res.status(400).json(errorResponse('Invalid transaction hash'));
    }

    const provider = getProvider(chain);
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(hash),
      provider.getTransactionReceipt(hash).catch(() => null)
    ]);

    if (!tx) return res.status(404).json(errorResponse('Transaction not found'));

    // Decode input if non-empty
    let decodedInput = null;
    if (tx.data && tx.data !== '0x' && tx.data.length > 10) {
      decodedInput = { selector: tx.data.slice(0, 10), raw: tx.data };

      // Try known 4-byte selectors
      try {
        const resp = await axios.get(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${tx.data.slice(0, 10)}`, { timeout: 5000 });
        const results = resp.data?.results || [];
        if (results.length > 0) {
          decodedInput.textSignatures = results.map(r => r.text_signature);
        }
      } catch (_) {} // 4byte lookup is optional
    }

    // Decode revert reason if tx failed
    let revertReason = null;
    if (receipt && receipt.status === 0) {
      try {
        await provider.call({ to: tx.to, data: tx.data, from: tx.from }, receipt.blockNumber);
      } catch (callErr) {
        const raw = callErr?.data || callErr?.error?.data;
        if (raw) revertReason = decodeRevertBytes(raw);
        else revertReason = { type: 'Error', message: callErr.reason || callErr.message };
      }
    }

    return res.json(successResponse({
      hash,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      valueWei: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') + ' gwei' : null,
      maxFeePerGas: tx.maxFeePerGas ? ethers.formatUnits(tx.maxFeePerGas, 'gwei') + ' gwei' : null,
      nonce: tx.nonce,
      data: tx.data,
      decodedInput,
      receipt: receipt ? {
        status: receipt.status === 1 ? 'success' : 'failed',
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice ? ethers.formatUnits(receipt.gasPrice, 'gwei') + ' gwei' : null,
        logsCount: receipt.logs.length,
        blockNumber: receipt.blockNumber
      } : null,
      revertReason,
      explorerUrl: getTxExplorerUrl(hash, chain),
      ...chainMetadata
    }));
  } catch (error) {
    console.error('getTransaction error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ─── GET /chain/block/:number ─────────────────────────────────────────────────
async function getBlock(req, res) {
  try {
    const { number } = req.params;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);
    const blockTag = number === 'latest' ? 'latest' : parseInt(number);
    if (number !== 'latest' && isNaN(blockTag)) {
      return res.status(400).json(errorResponse('Invalid block number'));
    }

    const provider = getProvider(chain);
    const block = await provider.getBlock(blockTag);
    if (!block) return res.status(404).json(errorResponse('Block not found'));

    return res.json(successResponse({
      blockNumber: block.number,
      blockHash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      timestampIso: new Date(block.timestamp * 1000).toISOString(),
      miner: block.miner,
      gasLimit: block.gasLimit.toString(),
      gasUsed: block.gasUsed.toString(),
      gasUsedPct: ((Number(block.gasUsed) / Number(block.gasLimit)) * 100).toFixed(2) + '%',
      baseFeePerGas: block.baseFeePerGas ? ethers.formatUnits(block.baseFeePerGas, 'gwei') + ' gwei' : null,
      transactionCount: block.transactions.length,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('getBlock error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ─── POST /chain/events ───────────────────────────────────────────────────────
/**
 * Fetch contract events via eth_getLogs.
 * Body: { contractAddress, eventSignature?, fromBlock?, toBlock?, topics? }
 * eventSignature example: "Transfer(address,address,uint256)"
 */
async function getEvents(req, res) {
  try {
    const { contractAddress, eventSignature, fromBlock, toBlock, topics, limit = 100 } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    if (!contractAddress) return res.status(400).json(errorResponse('contractAddress is required'));
    if (!ethers.isAddress(contractAddress)) return res.status(400).json(errorResponse('Invalid contractAddress'));

    const provider = getProvider(chain);
    const latest = await provider.getBlockNumber();

    const _fromBlock = fromBlock ?? Math.max(0, latest - 1000);
    const _toBlock = toBlock ?? latest;

    // Build filter
    const filter = {
      address: contractAddress,
      fromBlock: _fromBlock,
      toBlock: _toBlock
    };

    if (topics) {
      filter.topics = topics;
    } else if (eventSignature) {
      filter.topics = [ethers.id(eventSignature)];
    }

    const logs = await provider.getLogs(filter);
    const sliced = logs.slice(0, Math.min(limit, 500));

    // Try to decode each log if we have an event signature
    let iface = null;
    if (eventSignature) {
      try { iface = new ethers.Interface([`event ${eventSignature}`]); } catch (_) {}
    }

    const decoded = sliced.map(log => {
      let parsedArgs = null;
      if (iface) {
        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          parsedArgs = parsed ? Object.fromEntries(
            parsed.fragment.inputs.map((inp, i) => [inp.name || `arg${i}`, parsed.args[i]?.toString()])
          ) : null;
        } catch (_) {}
      }
      return {
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        topics: log.topics,
        data: log.data,
        decodedArgs: parsedArgs,
        explorerUrl: getTxExplorerUrl(log.transactionHash, chain)
      };
    });

    return res.json(successResponse({
      contractAddress,
      eventSignature: eventSignature || null,
      fromBlock: _fromBlock,
      toBlock: _toBlock,
      totalFound: logs.length,
      returned: decoded.length,
      events: decoded,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('getEvents error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ─── POST /chain/decode/calldata ──────────────────────────────────────────────
/**
 * Decode raw calldata using a provided ABI.
 * Body: { calldata, abi }
 */
async function decodeCalldata(req, res) {
  try {
    const { calldata, abi } = req.body;
    if (!calldata) return res.status(400).json(errorResponse('calldata is required'));
    if (!abi || !Array.isArray(abi)) return res.status(400).json(errorResponse('abi (array) is required'));

    const iface = new ethers.Interface(abi);
    const selector = calldata.slice(0, 10);

    let decoded = null;
    let fragment = null;
    try {
      const tx = iface.parseTransaction({ data: calldata });
      if (tx) {
        fragment = tx.fragment;
        decoded = {};
        tx.fragment.inputs.forEach((inp, i) => {
          decoded[inp.name || `arg${i}`] = tx.args[i]?.toString();
        });
      }
    } catch (e) {
      return res.status(400).json(errorResponse('Could not decode calldata with provided ABI: ' + e.message));
    }

    return res.json(successResponse({
      selector,
      functionName: fragment?.name || null,
      functionSignature: fragment ? `${fragment.name}(${fragment.inputs.map(i => i.type).join(',')})` : null,
      stateMutability: fragment?.stateMutability || null,
      decodedArgs: decoded,
      rawCalldata: calldata
    }));
  } catch (error) {
    console.error('decodeCalldata error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ─── POST /chain/decode/revert ────────────────────────────────────────────────
/**
 * Decode a revert reason from hex data or a tx hash.
 * Body: { data? (hex), txHash? }
 */
async function decodeRevert(req, res) {
  try {
    const { data, txHash } = req.body;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    let revertData = data;

    // If txHash provided, simulate the call to get revert data
    if (!revertData && txHash) {
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return res.status(400).json(errorResponse('Invalid txHash'));
      }
      const provider = getProvider(chain);
      const tx = await provider.getTransaction(txHash);
      if (!tx) return res.status(404).json(errorResponse('Transaction not found'));

      try {
        await provider.call({ to: tx.to, data: tx.data, from: tx.from }, tx.blockNumber);
        return res.json(successResponse({ revertReason: null, message: 'Transaction did not revert (simulation succeeded)', ...chainMetadata }));
      } catch (callErr) {
        revertData = callErr?.data || callErr?.error?.data;
        if (!revertData) {
          return res.json(successResponse({
            revertReason: { type: 'Error', message: callErr.reason || callErr.message },
            ...chainMetadata
          }));
        }
      }
    }

    if (!revertData) return res.status(400).json(errorResponse('Provide data (hex) or txHash'));

    const revertReason = decodeRevertBytes(revertData);

    return res.json(successResponse({
      revertReason,
      raw: revertData,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('decodeRevert error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ─── GET /chain/address/:address/txs ─────────────────────────────────────────
/**
 * Get recent transactions for an address via Etherscan.
 * Query: ?limit=20&page=1&sort=desc
 */
async function getAddressTxs(req, res) {
  try {
    const { address } = req.params;
    const { limit = 20, page = 1, sort = 'desc' } = req.query;
    const chain = getChainFromRequest(req);
    const chainMetadata = getChainMetadata(chain);

    if (!ethers.isAddress(address)) {
      return res.status(400).json(errorResponse('Invalid address'));
    }
    if (!isArbitrumChain(chain)) {
      return res.status(400).json(errorResponse('Address transaction history is available on Arbitrum Sepolia only in the current build.'));
    }
    if (!ETHERSCAN_API_KEY) {
      return res.status(503).json(errorResponse('ETHERSCAN_API_KEY not configured'));
    }

    const response = await etherscanRequest({
      module: 'account',
      action: 'txlist',
      address,
      startblock: 0,
      endblock: 99999999,
      page,
      offset: Math.min(limit, 100),
      sort
    });

    if (response.data.status === '0' && response.data.message !== 'No transactions found') {
      return res.status(400).json(errorResponse(response.data.result || 'Etherscan error'));
    }

    const txs = (response.data.result || []).map(tx => ({
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      timestamp: parseInt(tx.timeStamp),
      timestampIso: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value || '0'),
      gasUsed: tx.gasUsed,
      isError: tx.isError === '1',
      methodId: tx.methodId || null,
      functionName: tx.functionName || null,
      explorerUrl: getTxExplorerUrl(tx.hash)
    }));

    return res.json(successResponse({
      address,
      explorerUrl: getAddressExplorerUrl(address, chain),
      transactionCount: txs.length,
      transactions: txs,
      ...chainMetadata
    }));
  } catch (error) {
    console.error('getAddressTxs error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = {
  getTransaction,
  getBlock,
  getEvents,
  decodeCalldata,
  decodeRevert,
  getAddressTxs
};

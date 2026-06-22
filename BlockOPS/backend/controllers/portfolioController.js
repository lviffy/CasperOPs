/**
 * Portfolio Controller
 *
 * GET /portfolio/:address
 *   Returns full wallet snapshot:
 *   – ETH balance + USD value
 *   – ERC20 token holdings (via Etherscan token list)
 *   – ERC721 NFT holdings (via Etherscan NFT list)
 *   – Per-token USD prices (CoinGecko)
 *   – Total portfolio USD value
 */

const { ethers } = require('ethers');
const axios = require('axios');
const { getProvider } = require('../utils/blockchain');
const { successResponse, errorResponse, getAddressExplorerUrl } = require('../utils/helpers');
const {
  ETHERSCAN_V2_BASE_URL,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ETHERSCAN_API_KEY
} = require('../config/constants');

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const STANDARD_ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];

function etherscanReq(params) {
  return axios.get(ETHERSCAN_V2_BASE_URL, {
    params: { chainid: ARBITRUM_SEPOLIA_CHAIN_ID, apikey: ETHERSCAN_API_KEY, ...params },
    timeout: 15000
  });
}

/** Fetch ETH/USD price from CoinGecko */
async function fetchEthUsd() {
  try {
    const resp = await axios.get(`${COINGECKO_BASE}/simple/price`, {
      params: { ids: 'ethereum', vs_currencies: 'usd' },
      timeout: 8000
    });
    return resp.data?.ethereum?.usd || null;
  } catch (_) { return null; }
}

/** Try to get USD price for a token symbol via CoinGecko search */
async function fetchTokenUsd(symbol) {
  try {
    const search = await axios.get(`${COINGECKO_BASE}/search`, {
      params: { query: symbol },
      timeout: 8000
    });
    const coin = search.data?.coins?.[0];
    if (!coin) return null;
    const price = await axios.get(`${COINGECKO_BASE}/simple/price`, {
      params: { ids: coin.id, vs_currencies: 'usd' },
      timeout: 8000
    });
    return price.data?.[coin.id]?.usd || null;
  } catch (_) { return null; }
}

async function getPortfolio(req, res) {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json(errorResponse('Invalid address'));
    }

    const provider = getProvider();

    // ── Fetch all raw data in parallel ──────────────────────────────────────
    const [ethBalanceRaw, ethUsd, erc20Resp, nftResp] = await Promise.all([
      provider.getBalance(address),
      fetchEthUsd(),
      ETHERSCAN_API_KEY
        ? etherscanReq({ module: 'account', action: 'tokentx', address, startblock: 0, endblock: 99999999, sort: 'desc', offset: 200 }).catch(() => null)
        : Promise.resolve(null),
      ETHERSCAN_API_KEY
        ? etherscanReq({ module: 'account', action: 'tokennfttx', address, startblock: 0, endblock: 99999999, sort: 'desc', offset: 200 }).catch(() => null)
        : Promise.resolve(null)
    ]);

    const ethBalance = parseFloat(ethers.formatEther(ethBalanceRaw));
    const ethUsdValue = ethUsd ? parseFloat((ethBalance * ethUsd).toFixed(2)) : null;

    // ── Build ERC20 holdings from transfer history ──────────────────────────
    const erc20Contracts = new Map(); // address → { name, symbol, decimals }
    const erc20Txs = erc20Resp?.data?.result || [];

    for (const tx of erc20Txs) {
      const addr = tx.contractAddress?.toLowerCase();
      if (addr && !erc20Contracts.has(addr)) {
        erc20Contracts.set(addr, {
          address: tx.contractAddress,
          name: tx.tokenName || 'Unknown',
          symbol: tx.tokenSymbol || '?',
          decimals: parseInt(tx.tokenDecimal || '18')
        });
      }
    }

    // Get on-chain live balances for each unique ERC20
    const erc20Holdings = [];
    const balancePromises = [...erc20Contracts.values()].map(async (token) => {
      try {
        const contract = new ethers.Contract(token.address, STANDARD_ERC20_ABI, provider);
        const raw = await contract.balanceOf(address);
        const balance = parseFloat(ethers.formatUnits(raw, token.decimals));
        if (balance > 0) {
          const usdPrice = await fetchTokenUsd(token.symbol);
          const usdValue = usdPrice ? parseFloat((balance * usdPrice).toFixed(2)) : null;
          erc20Holdings.push({
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            balance: balance.toString(),
            priceUsd: usdPrice,
            valueUsd: usdValue
          });
        }
      } catch (_) {} // skip unreadable tokens
    });
    await Promise.all(balancePromises);

    // ── Build NFT holdings from transfer history ────────────────────────────
    const nftOwned = new Map(); // `${contract}:${tokenId}` → info
    const nftTxs = nftResp?.data?.result || [];

    for (const tx of nftTxs) {
      const key = `${tx.contractAddress?.toLowerCase()}:${tx.tokenID}`;
      const isInbound = tx.to?.toLowerCase() === address.toLowerCase();
      if (isInbound) {
        nftOwned.set(key, {
          contractAddress: tx.contractAddress,
          tokenId: tx.tokenID,
          name: tx.tokenName || 'Unknown Collection',
          symbol: tx.tokenSymbol || '?'
        });
      } else {
        nftOwned.delete(key); // sent away — remove
      }
    }

    const nftHoldings = [...nftOwned.values()];

    // ── Aggregate totals ────────────────────────────────────────────────────
    const erc20TotalUsd = erc20Holdings.reduce((sum, t) => sum + (t.valueUsd || 0), 0);
    const totalUsd = ethUsd ? parseFloat((ethUsdValue + erc20TotalUsd).toFixed(2)) : null;

    return res.json(successResponse({
      address,
      explorerUrl: getAddressExplorerUrl(address),
      network: 'Arbitrum Sepolia',
      eth: {
        balance: ethBalance.toString(),
        priceUsd: ethUsd,
        valueUsd: ethUsdValue
      },
      erc20: {
        count: erc20Holdings.length,
        tokens: erc20Holdings,
        totalValueUsd: parseFloat(erc20TotalUsd.toFixed(2))
      },
      nfts: {
        count: nftHoldings.length,
        tokens: nftHoldings
      },
      totalValueUsd: totalUsd,
      note: ETHERSCAN_API_KEY ? null : 'Set ETHERSCAN_API_KEY for ERC20/NFT breakdown (ETH balance always available)'
    }));
  } catch (error) {
    console.error('getPortfolio error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

module.exports = { getPortfolio };

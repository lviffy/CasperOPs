/**
 * ENS Controller — resolve ENS names ↔ addresses (Ethereum mainnet ENS)
 *
 * Note: ENS registry lives on Ethereum mainnet, not Arbitrum Sepolia.
 * These endpoints use a public mainnet RPC exclusively for ENS lookups.
 *
 * GET /ens/resolve/:name          — name → address
 * GET /ens/reverse/:address       — address → primary name
 * POST /ens/resolve-many          — batch resolve up to 20 names at once
 */

const { ethers } = require('ethers');
const { successResponse, errorResponse } = require('../utils/helpers');

// Public Ethereum mainnet provider for ENS resolution only.
// Falls back through a list to improve reliability.
const ENS_RPC_LIST = [
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth'
];

let _ensProvider = null;
function getEnsProvider() {
  if (_ensProvider) return _ensProvider;
  _ensProvider = new ethers.JsonRpcProvider(ENS_RPC_LIST[0]);
  return _ensProvider;
}

/** Attempt resolution across fallback RPCs */
async function resolveWithFallback(fn) {
  for (const rpc of ENS_RPC_LIST) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const result = await Promise.race([
        fn(provider),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
      ]);
      if (result !== null) return result;
    } catch (_) {}
  }
  return null;
}

// ── GET /ens/resolve/:name ────────────────────────────────────────────────────
async function resolveName(req, res) {
  try {
    const { name } = req.params;
    if (!name) return res.status(400).json(errorResponse('Name is required'));

    // Validate it looks like a name (contains a dot)
    if (!name.includes('.')) {
      return res.status(400).json(errorResponse('Invalid name format — expected something like vitalik.eth'));
    }

    const address = await resolveWithFallback(p => p.resolveName(name));

    if (!address) {
      return res.status(404).json(errorResponse(`Could not resolve "${name}" — name may not exist or have no address record`));
    }

    // Try to get avatar/text records
    let avatar = null;
    try {
      const provider = new ethers.JsonRpcProvider(ENS_RPC_LIST[0]);
      const resolver = await provider.getResolver(name);
      avatar = resolver ? await resolver.getAvatar() : null;
    } catch (_) {}

    return res.json(successResponse({
      name,
      address,
      avatar: avatar?.url || null,
      network: 'Ethereum Mainnet (ENS registry)',
      arbiscanUrl: `https://sepolia.arbiscan.io/address/${address}`
    }));
  } catch (error) {
    console.error('resolveName error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── GET /ens/reverse/:address ─────────────────────────────────────────────────
async function reverseLookup(req, res) {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      return res.status(400).json(errorResponse('Invalid Ethereum address'));
    }

    const name = await resolveWithFallback(p => p.lookupAddress(address));

    if (!name) {
      return res.json(successResponse({
        address,
        name: null,
        message: 'No primary ENS name set for this address'
      }));
    }

    return res.json(successResponse({
      address,
      name,
      network: 'Ethereum Mainnet (ENS registry)'
    }));
  } catch (error) {
    console.error('reverseLookup error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── POST /ens/resolve-many ────────────────────────────────────────────────────
/**
 * Body: { names: ["vitalik.eth", "nick.eth", ...] }  — up to 20
 */
async function resolveMany(req, res) {
  try {
    const { names } = req.body;
    if (!names || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json(errorResponse('names (array) is required'));
    }
    if (names.length > 20) {
      return res.status(400).json(errorResponse('Maximum 20 names per batch'));
    }

    const provider = new ethers.JsonRpcProvider(ENS_RPC_LIST[0]);

    const results = await Promise.all(
      names.map(async (name) => {
        try {
          const address = await Promise.race([
            provider.resolveName(name),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
          ]);
          return { name, address: address || null, error: address ? null : 'Not resolved' };
        } catch (e) {
          return { name, address: null, error: e.message };
        }
      })
    );

    const resolved = results.filter(r => r.address).length;

    return res.json(successResponse({
      total: names.length,
      resolved,
      failed: names.length - resolved,
      results
    }));
  } catch (error) {
    console.error('resolveMany error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── Utility: auto-resolve name-or-address — used by other controllers ─────────
/**
 * If input looks like an ENS name (contains "."), resolve it to an address.
 * Otherwise returns input unchanged (assumes it's already an address).
 * Returns null if resolution fails.
 */
async function resolveAddressOrName(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed.includes('.')) return trimmed; // already an address
  return resolveWithFallback(p => p.resolveName(trimmed));
}

module.exports = { resolveName, reverseLookup, resolveMany, resolveAddressOrName };

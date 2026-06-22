/**
 * Bridge Controller — L1 (Ethereum Sepolia) ↔ L2 (Arbitrum Sepolia)
 *
 * POST /bridge/deposit          — deposit ETH or ERC20 from L1 → L2
 * POST /bridge/withdraw         — initiate ETH or ERC20 withdrawal from L2 → L1
 * GET  /bridge/status/:txHash   — retryable ticket status for a deposit tx
 * POST /bridge/retryable        — re-execute a failed retryable ticket
 *
 * Architecture notes:
 *   • Deposits are signed on L1 (Ethereum Sepolia) — private key is the same keypair.
 *   • Withdrawals are signed on L2 (Arbitrum Sepolia) — uses existing getProvider().
 *   • The RetryableTx precompile (0x6E) is used to redeem failed tickets.
 *   • L2 retryable ticket status is fetched via the ArbRetryableTx precompile.
 */

const { ethers } = require('ethers');
const { getProvider, getWallet } = require('../utils/blockchain');
const { successResponse, errorResponse, getTxExplorerUrl } = require('../utils/helpers');
const { fireEvent } = require('../services/webhookService');

// ── Network config ────────────────────────────────────────────────────────────

const L1_SEPOLIA_RPCS = [
  process.env.ETHEREUM_SEPOLIA_RPC || 'https://rpc.sepolia.org',
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.gateway.tenderly.co'
];

const L1_EXPLORER  = 'https://sepolia.etherscan.io';
const L2_EXPLORER  = 'https://sepolia.arbiscan.io';

// ── Arbitrum Sepolia contract addresses ───────────────────────────────────────

// L1 (Ethereum Sepolia) contracts
const L1_INBOX_ADDRESS          = process.env.L1_INBOX_ADDRESS          || '0xaAe29B0366299461418F5324a79Afc425BE5ae21';
const L1_GATEWAY_ROUTER_ADDRESS = process.env.L1_GATEWAY_ROUTER_ADDRESS || '0xcE18836b233C83325Cc8848CA4487e94C6288264';

// L2 (Arbitrum Sepolia) precompiles — addresses are fixed by the protocol
const L2_ARBSYS_ADDRESS         = '0x0000000000000000000000000000000000000064'; // ArbSys
const L2_RETRYABLE_TX_ADDRESS   = '0x000000000000000000000000000000000000006E'; // ArbRetryableTx
const L2_GATEWAY_ROUTER_ADDRESS = process.env.L2_GATEWAY_ROUTER_ADDRESS || '0x9fDD1C4E4AA24EEc1d913FABea925594a20d43C7';

// ── ABIs ─────────────────────────────────────────────────────────────────────

const L1_INBOX_ABI = [
  // depositEth: deposits ETH to L2 for msg.sender at L2
  'function depositEth() external payable returns (uint256)',
  // createRetryableTicket: general-purpose retryable for contract calls
  'function createRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes calldata data) external payable returns (uint256)',
  'function calculateRetryableSubmissionFee(uint256 dataLength, uint256 baseFee) external view returns (uint256)'
];

const L1_GATEWAY_ROUTER_ABI = [
  // outboundTransferCustomRefund: bridge ERC20 L1 → L2
  'function outboundTransferCustomRefund(address _token, address _refundTo, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes calldata _data) external payable returns (bytes memory)',
  'function getGateway(address _token) external view returns (address)'
];

const L1_ERC20_GATEWAY_ABI = [
  'function getOutboundCalldata(address _token, address _from, address _to, uint256 _amount, bytes memory _data) public pure returns (bytes memory)'
];

const ARBSYS_ABI = [
  // withdrawEth: initiate ETH withdrawal from L2 to L1
  'function withdrawEth(address destination) external payable returns (uint256)',
  'function arbBlockNumber() external view returns (uint256)'
];

const ARBRETRYABLETX_ABI = [
  'function getTicketStatus(bytes32 ticketId) external view returns (uint8)',
  'function redeem(bytes32 ticketId) external returns (bytes32)',
  'function getTimeout(bytes32 ticketId) external view returns (uint256)',
  'function getSubmissionId(bytes32 ticketId) external view returns (bytes32)',
  'function keepalive(bytes32 ticketId) external returns (uint256)'
];

const L2_GATEWAY_ROUTER_ABI = [
  'function outboundTransfer(address _token, address _to, uint256 _amount, bytes calldata _data) external payable returns (bytes memory)'
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getL1Provider() {
  for (const rpc of L1_SEPOLIA_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await p.getBlockNumber(); // connectivity check
      return p;
    } catch (_) {}
  }
  throw new Error('All Ethereum Sepolia RPC endpoints are unreachable. Provide a valid ETHEREUM_SEPOLIA_RPC in .env');
}

function getL2Provider() {
  return getProvider(); // Arbitrum Sepolia
}

// Derive retryable ticket ID from the L1 deposit tx (deterministic hash)
function deriveTicketId(l1TxHash) {
  // The canonical retryable ticket ID is keccak256(l1TxHash, seqNum)
  // For simple depositEth the sequence number is embedded in the tx receipt.
  // We return the raw tx hash here as a lookup key — the status endpoint
  // uses a broader approach to surface ticket state.
  return l1TxHash;
}

// Ticket status codes from ArbRetryableTx
const TICKET_STATUS = {
  0: 'not_found',
  1: 'created',       // Submitted, waiting to be auto-redeemed
  2: 'auto_redeemed', // Successfully auto-redeemed on L2
  3: 'redeemed',      // Manually redeemed
  4: 'expired'        // Timed out before redemption
};

// ── POST /bridge/deposit ──────────────────────────────────────────────────────
/**
 * Deposit ETH or ERC20 from Ethereum Sepolia (L1) to Arbitrum Sepolia (L2).
 *
 * Body: { privateKey, amount, tokenAddress? (omit for ETH), destinationAddress? }
 *
 * ETH deposit: calls Inbox.depositEth() with msg.value
 * ERC20 deposit: approves L1GatewayRouter, then calls outboundTransferCustomRefund
 */
async function depositToL2(req, res) {
  try {
    const {
      privateKey,
      amount,
      tokenAddress,
      destinationAddress
    } = req.body;

    if (!privateKey) return res.status(400).json(errorResponse('privateKey is required'));
    if (!amount)     return res.status(400).json(errorResponse('amount is required'));

    const l1Provider  = await getL1Provider();
    const l1Wallet    = new ethers.Wallet(privateKey, l1Provider);
    const destination = destinationAddress || l1Wallet.address;

    const isEthDeposit = !tokenAddress;

    if (isEthDeposit) {
      // ── ETH deposit ────────────────────────────────────────────────────────
      const amountWei   = ethers.parseEther(String(amount));
      const l1Balance   = await l1Provider.getBalance(l1Wallet.address);

      // Estimate submission fee from inbox (~0.001 ETH buffer)
      const gasBuffer   = ethers.parseEther('0.002');
      if (l1Balance < amountWei + gasBuffer) {
        return res.status(400).json(errorResponse(
          `Insufficient L1 ETH balance. Have ${ethers.formatEther(l1Balance)} ETH, need ${amount} ETH + gas`
        ));
      }

      const inbox = new ethers.Contract(L1_INBOX_ADDRESS, L1_INBOX_ABI, l1Wallet);
      console.log(`[Bridge] Depositing ${amount} ETH from L1 (${l1Wallet.address}) to L2 (${destination})`);

      const tx = await inbox.depositEth({
        value: amountWei,
        gasLimit: 100000n
      });
      const receipt = await tx.wait();

      const agentId = req.apiKey?.agentId || null;
      await fireEvent('tx.sent', agentId, {
        type: 'bridge_deposit_eth',
        txHash: tx.hash,
        from: l1Wallet.address,
        to: destination,
        amount,
        network: 'Ethereum Sepolia → Arbitrum Sepolia'
      }).catch(() => {});

      return res.json(successResponse({
        txHash:      tx.hash,
        explorerUrl: `${L1_EXPLORER}/tx/${tx.hash}`,
        status:      receipt.status === 1 ? 'submitted' : 'failed',
        type:        'ETH deposit',
        from:        l1Wallet.address,
        to:          destination,
        amount:      `${amount} ETH`,
        l1Network:   'Ethereum Sepolia',
        l2Network:   'Arbitrum Sepolia',
        note:        'ETH will arrive on Arbitrum Sepolia within ~10–15 minutes after L1 confirmation.',
        trackStatus: `GET /bridge/status/${tx.hash}`
      }));
    } else {
      // ── ERC20 deposit ──────────────────────────────────────────────────────
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, l1Provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'ERC20'),
        tokenContract.decimals().catch(() => 18n)
      ]);
      const amountWei = ethers.parseUnits(String(amount), decimals);

      const l1Balance   = await tokenContract.balanceOf(l1Wallet.address);
      if (l1Balance < amountWei) {
        return res.status(400).json(errorResponse(
          `Insufficient ${symbol} balance on L1. Have ${ethers.formatUnits(l1Balance, decimals)}, need ${amount}`
        ));
      }

      // Get the L1 gateway for this token
      const gatewayRouter = new ethers.Contract(L1_GATEWAY_ROUTER_ADDRESS, L1_GATEWAY_ROUTER_ABI, l1Provider);
      let l1Gateway;
      try {
        l1Gateway = await gatewayRouter.getGateway(tokenAddress);
      } catch (_) {
        l1Gateway = L1_GATEWAY_ROUTER_ADDRESS; // Fallback: go through router directly
      }

      // Approve l1Gateway to spend tokens
      const tokenSigner = new ethers.Contract(tokenAddress, ERC20_ABI, l1Wallet);
      const allowance   = await tokenSigner.allowance(l1Wallet.address, l1Gateway);
      if (allowance < amountWei) {
        console.log(`[Bridge] Approving ${l1Gateway} to spend ${symbol}…`);
        const approveTx = await tokenSigner.approve(l1Gateway, ethers.MaxUint256);
        await approveTx.wait();
      }

      // Submission cost for retryable ticket
      const feeData        = await l1Provider.getFeeData();
      const gasPriceBid    = feeData.gasPrice + (feeData.gasPrice / 10n); // +10% buffer
      const maxGas         = 300000n;
      const submissionCost = ethers.parseEther('0.001'); // manual estimate

      const routerSigner = new ethers.Contract(L1_GATEWAY_ROUTER_ADDRESS, L1_GATEWAY_ROUTER_ABI, l1Wallet);
      const callValue    = submissionCost + maxGas * gasPriceBid; // total ETH to send with tx

      console.log(`[Bridge] Depositing ${amount} ${symbol} from L1 to L2`);
      const tx = await routerSigner.outboundTransferCustomRefund(
        tokenAddress,
        l1Wallet.address,  // refund recipient
        destination,
        amountWei,
        maxGas,
        gasPriceBid,
        '0x',              // no extra data
        { value: callValue }
      );
      const receipt = await tx.wait();

      const agentId = req.apiKey?.agentId || null;
      await fireEvent('tx.sent', agentId, {
        type: 'bridge_deposit_erc20',
        txHash: tx.hash,
        from: l1Wallet.address,
        token: symbol,
        amount
      }).catch(() => {});

      return res.json(successResponse({
        txHash:      tx.hash,
        explorerUrl: `${L1_EXPLORER}/tx/${tx.hash}`,
        status:      receipt.status === 1 ? 'submitted' : 'failed',
        type:        `ERC20 deposit (${symbol})`,
        from:        l1Wallet.address,
        to:          destination,
        amount:      `${amount} ${symbol}`,
        tokenAddress,
        l1Network:   'Ethereum Sepolia',
        l2Network:   'Arbitrum Sepolia',
        note:        `${symbol} will arrive on Arbitrum Sepolia within ~10–15 minutes.`,
        trackStatus: `GET /bridge/status/${tx.hash}`
      }));
    }
  } catch (error) {
    console.error('bridgeDeposit error:', error);
    return res.status(500).json(errorResponse(error.shortMessage || error.message));
  }
}

// ── POST /bridge/withdraw ─────────────────────────────────────────────────────
/**
 * Initiate ETH or ERC20 withdrawal from Arbitrum Sepolia (L2) to Ethereum Sepolia (L1).
 * Note: L2→L1 withdrawals have a ~7-day challenge window on mainnet (instant on Sepolia testnet).
 *
 * Body: { privateKey, amount, tokenAddress? (omit for ETH), destinationAddress? }
 */
async function withdrawToL1(req, res) {
  try {
    const {
      privateKey,
      amount,
      tokenAddress,
      destinationAddress
    } = req.body;

    if (!privateKey) return res.status(400).json(errorResponse('privateKey is required'));
    if (!amount)     return res.status(400).json(errorResponse('amount is required'));

    const l2Provider  = getL2Provider();
    const l2Wallet    = getWallet(privateKey, l2Provider);
    const destination = destinationAddress || l2Wallet.address;

    const isEthWithdraw = !tokenAddress;

    if (isEthWithdraw) {
      // ── ETH withdrawal ─────────────────────────────────────────────────────
      const amountWei = ethers.parseEther(String(amount));
      const l2Balance = await l2Provider.getBalance(l2Wallet.address);
      const gasBuffer = ethers.parseEther('0.001');
      if (l2Balance < amountWei + gasBuffer) {
        return res.status(400).json(errorResponse(
          `Insufficient L2 ETH balance. Have ${ethers.formatEther(l2Balance)} ETH, need ${amount} ETH + gas`
        ));
      }

      const arbSys = new ethers.Contract(L2_ARBSYS_ADDRESS, ARBSYS_ABI, l2Wallet);
      console.log(`[Bridge] Withdrawing ${amount} ETH from L2 to L1 (${destination})`);

      const tx      = await arbSys.withdrawEth(destination, { value: amountWei });
      const receipt = await tx.wait();

      // Extract the L2-to-L1 message sequence number from logs
      let l2ToL1MsgSeqNum = null;
      for (const log of receipt.logs || []) {
        if (log.topics[0] === ethers.id('L2ToL1Tx(address,address,uint256,uint256,uint256,uint256,uint256,uint256,bytes)')) {
          try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
              ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
              log.data
            );
            l2ToL1MsgSeqNum = decoded[1]?.toString();
          } catch (_) {}
          break;
        }
      }

      const agentId = req.apiKey?.agentId || null;
      await fireEvent('tx.sent', agentId, {
        type: 'bridge_withdraw_eth',
        txHash: tx.hash,
        from: l2Wallet.address,
        to: destination,
        amount
      }).catch(() => {});

      return res.json(successResponse({
        txHash:       tx.hash,
        explorerUrl:  `${L2_EXPLORER}/tx/${tx.hash}`,
        status:       receipt.status === 1 ? 'initiated' : 'failed',
        type:         'ETH withdrawal',
        from:         l2Wallet.address,
        to:           destination,
        amount:       `${amount} ETH`,
        l2ToL1MsgSeqNum,
        l1Network:    'Ethereum Sepolia',
        l2Network:    'Arbitrum Sepolia',
        challengeWindow: 'On Sepolia testnet: typically a few minutes. On mainnet: 7 days.',
        note:         'After the challenge window, claim funds on L1 using the L2-to-L1 message.'
      }));
    } else {
      // ── ERC20 withdrawal ───────────────────────────────────────────────────
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, l2Provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'ERC20'),
        tokenContract.decimals().catch(() => 18n)
      ]);
      const amountWei = ethers.parseUnits(String(amount), decimals);

      const l2Balance = await tokenContract.balanceOf(l2Wallet.address);
      if (l2Balance < amountWei) {
        return res.status(400).json(errorResponse(
          `Insufficient ${symbol} balance on L2. Have ${ethers.formatUnits(l2Balance, decimals)}, need ${amount}`
        ));
      }

      // Approve L2 gateway router
      const tokenSigner = new ethers.Contract(tokenAddress, ERC20_ABI, l2Wallet);
      const allowance   = await tokenSigner.allowance(l2Wallet.address, L2_GATEWAY_ROUTER_ADDRESS);
      if (allowance < amountWei) {
        console.log(`[Bridge] Approving L2GatewayRouter to spend ${symbol}…`);
        const approveTx = await tokenSigner.approve(L2_GATEWAY_ROUTER_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
      }

      const l2Router = new ethers.Contract(L2_GATEWAY_ROUTER_ADDRESS, L2_GATEWAY_ROUTER_ABI, l2Wallet);
      console.log(`[Bridge] Withdrawing ${amount} ${symbol} from L2 to L1 (${destination})`);

      const tx      = await l2Router.outboundTransfer(tokenAddress, destination, amountWei, '0x');
      const receipt = await tx.wait();

      const agentId = req.apiKey?.agentId || null;
      await fireEvent('tx.sent', agentId, {
        type: 'bridge_withdraw_erc20',
        txHash: tx.hash,
        from: l2Wallet.address,
        token: symbol,
        amount
      }).catch(() => {});

      return res.json(successResponse({
        txHash:      tx.hash,
        explorerUrl: `${L2_EXPLORER}/tx/${tx.hash}`,
        status:      receipt.status === 1 ? 'initiated' : 'failed',
        type:        `ERC20 withdrawal (${symbol})`,
        from:        l2Wallet.address,
        to:          destination,
        amount:      `${amount} ${symbol}`,
        tokenAddress,
        l1Network:   'Ethereum Sepolia',
        l2Network:   'Arbitrum Sepolia',
        note:        'After the challenge window, claim tokens on L1.'
      }));
    }
  } catch (error) {
    console.error('bridgeWithdraw error:', error);
    return res.status(500).json(errorResponse(error.shortMessage || error.message));
  }
}

// ── GET /bridge/status/:txHash ────────────────────────────────────────────────
/**
 * Retrieve the status of a retryable ticket created by a deposit tx.
 * Uses the ArbRetryableTx precompile on L2 to check the ticket.
 *
 * The retryable ticket ID for a simple ETH deposit is derived from the L1 tx hash
 * and the inbox sequence number. We also expose raw L2 tx receipt lookup.
 */
async function getBridgeStatus(req, res) {
  try {
    const { txHash } = req.params;
    if (!txHash || !txHash.startsWith('0x')) {
      return res.status(400).json(errorResponse('txHash must be a valid hex transaction hash'));
    }

    const l1Provider = await getL1Provider();
    const l2Provider = getL2Provider();

    // 1. Fetch L1 tx receipt
    let l1Receipt = null;
    let l1Status  = 'not_found';
    try {
      l1Receipt = await l1Provider.getTransactionReceipt(txHash);
      if (l1Receipt) {
        l1Status = l1Receipt.status === 1 ? 'confirmed' : 'failed';
      }
    } catch (_) {}

    // 2. Derive retryable ticket ID — for Arbitrum the ticket ID is deterministic:
    //    ticketId = keccak256(abi.encodePacked(inboxSeqNum)) for ETH deposits
    //    For simplicity, we derive it the canonical way from the sequence number log
    let ticketId     = null;
    let ticketStatus = 'unknown';
    let ticketTimeout = null;

    if (l1Receipt) {
      // Look for MessageDelivered event from the inbox to get sequence number
      const messageDeliveredTopic = ethers.id('MessageDelivered(uint256,bytes32,address,uint8,address,bytes32,uint256,uint64)');
      for (const log of l1Receipt.logs || []) {
        if (log.topics[0] === messageDeliveredTopic) {
          try {
            const seqNum = BigInt(log.topics[1]);
            // Ticket ID = keccak256(seqNum as uint256)
            ticketId = ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [seqNum])
            );
            break;
          } catch (_) {}
        }
      }
    }

    if (ticketId) {
      try {
        const retryable = new ethers.Contract(L2_RETRYABLE_TX_ADDRESS, ARBRETRYABLETX_ABI, l2Provider);
        const [statusCode, timeout] = await Promise.all([
          retryable.getTicketStatus(ticketId).catch(() => null),
          retryable.getTimeout(ticketId).catch(() => null)
        ]);
        if (statusCode !== null) {
          ticketStatus  = TICKET_STATUS[Number(statusCode)] || 'unknown';
        }
        if (timeout) {
          ticketTimeout = new Date(Number(timeout) * 1000).toISOString();
        }
      } catch (_) {}
    }

    // 3. Fallback: try to find the L2 tx via the tx hash directly
    //    (not the same hash — just surface L2 network state)
    const l2Block = await l2Provider.getBlockNumber().catch(() => null);

    return res.json(successResponse({
      l1TxHash: txHash,
      ticketId:     ticketId     || 'could not derive (non-deposit tx or event not found)',
      ticketStatus: ticketStatus,
      ticketExpiry: ticketTimeout,
      l1: {
        network: 'Ethereum Sepolia',
        status:  l1Status,
        blockNumber: l1Receipt?.blockNumber || null,
        explorerUrl: `${L1_EXPLORER}/tx/${txHash}`
      },
      l2: {
        network:          'Arbitrum Sepolia',
        currentBlock:     l2Block,
        explorerUrl:      `${L2_EXPLORER}/tx/${txHash}`
      },
      note: ticketStatus === 'auto_redeemed' || ticketStatus === 'redeemed'
        ? 'Your deposit has been successfully processed on L2.'
        : ticketStatus === 'created'
          ? 'Retryable ticket created. Auto-redemption in progress.'
          : ticketStatus === 'expired'
            ? 'Ticket expired. Use POST /bridge/retryable to redeem if still valid.'
            : 'Status unclear — ticket may not have been created yet or the tx is not a deposit.'
    }));
  } catch (error) {
    console.error('getBridgeStatus error:', error);
    return res.status(500).json(errorResponse(error.message));
  }
}

// ── POST /bridge/retryable ────────────────────────────────────────────────────
/**
 * Re-execute (redeem) a failed retryable ticket on L2.
 *
 * Body: { privateKey, ticketId }
 *   ticketId — the retryable ticket ID (bytes32 hex from /bridge/status)
 */
async function redeemRetryable(req, res) {
  try {
    const { privateKey, ticketId } = req.body;

    if (!privateKey) return res.status(400).json(errorResponse('privateKey is required'));
    if (!ticketId)   return res.status(400).json(errorResponse('ticketId is required (get it from GET /bridge/status/:l1TxHash)'));

    const l2Provider = getL2Provider();
    const l2Wallet   = getWallet(privateKey, l2Provider);

    const retryable = new ethers.Contract(L2_RETRYABLE_TX_ADDRESS, ARBRETRYABLETX_ABI, l2Wallet);

    // Check current status before redeeming
    let currentStatus = 'unknown';
    try {
      const statusCode  = await retryable.getTicketStatus(ticketId);
      currentStatus     = TICKET_STATUS[Number(statusCode)] || 'unknown';
    } catch (_) {}

    if (currentStatus === 'redeemed' || currentStatus === 'auto_redeemed') {
      return res.status(400).json(errorResponse(`Ticket is already redeemed (status: ${currentStatus})`));
    }
    if (currentStatus === 'expired') {
      return res.status(400).json(errorResponse('Ticket has expired and cannot be redeemed'));
    }
    if (currentStatus === 'not_found') {
      return res.status(404).json(errorResponse('Ticket not found on L2. Verify the ticketId is correct.'));
    }

    console.log(`[Bridge] Redeeming retryable ticket ${ticketId} (current status: ${currentStatus})`);
    const tx      = await retryable.redeem(ticketId);
    const receipt = await tx.wait();

    return res.json(successResponse({
      txHash:         tx.hash,
      explorerUrl:    `${L2_EXPLORER}/tx/${tx.hash}`,
      status:         receipt.status === 1 ? 'redeemed' : 'failed',
      ticketId,
      previousStatus: currentStatus,
      redeemer:       l2Wallet.address,
      note:           receipt.status === 1
        ? 'Retryable ticket successfully redeemed on L2.'
        : 'Redemption transaction was sent but may have failed. Check the explorer.'
    }));
  } catch (error) {
    console.error('redeemRetryable error:', error);
    return res.status(500).json(errorResponse(error.shortMessage || error.message));
  }
}

module.exports = { depositToL2, withdrawToL1, getBridgeStatus, redeemRetryable };

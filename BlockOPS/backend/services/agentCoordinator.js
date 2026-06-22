const { ethers } = require('ethers');
const { getProvider } = require('../utils/blockchain');

const IDENTITY_ABI = [
  "function registerAgent(address owner, string memory agentURI) public returns (uint256)",
  "function ownerOf(uint256 agentId) public view returns (address)",
  "function tokenURI(uint256 agentId) public view returns (string)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)"
];

const REPUTATION_ABI = [
  "function getAverageScore(uint256 agentId, string memory tag) public view returns (uint256)",
  "function getSummary(uint256 agentId, string memory tag) public view returns (uint256 count, uint256 summaryValue)"
];

/**
 * Agent Orchestrator
 * Handles discovery and trust-gated handoffs between agents via ERC-8004
 */
class AgentOrchestrator {
  constructor() {
    this.provider = getProvider();
    this.identityAddr = process.env.IDENTITY_REGISTRY_ADDRESS;
    this.reputationAddr = process.env.REPUTATION_REGISTRY_ADDRESS;
    this.TRUST_THRESHOLD = 75; // Default trust threshold
  }

  /**
   * Finds agents with specific capabilities and high reputation
   */
  async discoverAgents(capability, minScore = this.TRUST_THRESHOLD) {
    if (!this.identityAddr || !this.reputationAddr) return [];

    try {
      const identityContract = new ethers.Contract(this.identityAddr, IDENTITY_ABI, this.provider);
      const reputationContract = new ethers.Contract(this.reputationAddr, REPUTATION_ABI, this.provider);

      // In a real implementation, we'd query events or an indexer.
      // For this demo, we'll assume we're scanning the first few agents.
      const candidates = [];
      for (let i = 1; i <= 10; i++) {
        try {
          const owner = await identityContract.ownerOf(i);
          if (owner === ethers.ZeroAddress) break;

          const uri = await identityContract.tokenURI(i);
          // In a real app, fetch and parse the manifest from IPFS/URI
          // const manifest = await fetch(uri).then(r => r.json());
          
          const score = await reputationContract.getAverageScore(i, "successRate");
          
          if (Number(score) >= minScore) {
            candidates.push({
              agentId: i,
              owner,
              uri,
              score: Number(score)
            });
          }
        } catch (e) {
          // Agent doesn't exist yet, stop scanning
          break;
        }
      }

      return candidates.sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error('[Orchestrator] Discovery error:', err.message);
      return [];
    }
  }

  /**
   * Delegates a task to another agent if it meets trust requirements
   */
  async delegateTask(task, targetCapability) {
    console.log(`[Orchestrator] Searching for agent to handle: ${targetCapability}...`);
    
    const agents = await this.discoverAgents(targetCapability);
    if (agents.length === 0) {
      throw new Error(`No trusted agents found for capability: ${targetCapability}`);
    }

    const bestAgent = agents[0];
    console.log(`[Orchestrator] Selected Agent #${bestAgent.agentId} with score ${bestAgent.score}`);

    // In a real implementation, this would trigger an x402 payment 
    // and a call to the target agent's API/endpoint.
    return {
      delegatedTo: bestAgent.agentId,
      status: 'pending_payment',
      targetAgent: bestAgent
    };
  }
}

module.exports = { AgentOrchestrator };

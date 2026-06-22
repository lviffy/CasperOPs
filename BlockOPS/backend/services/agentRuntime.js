const { ethers } = require('ethers');
const crypto = require('crypto');
const { getProvider, getWallet } = require('../utils/blockchain');
const { fireEvent } = require('./webhookService');
const { AgentOrchestrator } = require('./agentCoordinator');
const supabase = require('../config/supabase');
const {
  isMissingOnChainIdColumnError,
  getOnChainIdColumnMigrationMessage,
} = require('../utils/agentSchema');

// Registry ABIs (simplified for our needs)
const IDENTITY_ABI = [
  "function registerAgent(address owner, string memory agentURI) public returns (uint256)",
  "function ownerOf(uint256 agentId) public view returns (address)",
  "function exists(uint256 agentId) public view returns (bool)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)"
];

const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, uint8 value, uint256 weight, string memory tag, string memory context, bytes32 proofHash) public",
  "function getAverageScore(uint256 agentId, string memory tag) public view returns (uint256)"
];

const VALIDATION_ABI = [
  "function validationRequest(address validator, uint256 agentId, string memory proofURI, bytes32 requestHash) public",
  "function updateValidationStatus(bytes32 requestHash, uint8 status) public"
];

let hasLoggedLegacyPersistenceMigrationWarning = false;

function isMissingTableError(error, tableName) {
  if (!error || !tableName) {
    return false;
  }

  const haystack = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const normalizedTable = String(tableName).toLowerCase();

  return (
    haystack.includes(`public.${normalizedTable}`) ||
    haystack.includes(`relation \"${normalizedTable}\"`) ||
    haystack.includes(`${normalizedTable} does not exist`) ||
    haystack.includes(`table '${normalizedTable}'`) ||
    haystack.includes(`table \"${normalizedTable}\"`)
  );
}

function shouldSkipLegacyExecutionPersistence(error) {
  return isMissingTableError(error, 'agent_executions') || isMissingTableError(error, 'tool_executions');
}

function logLegacyPersistenceMigrationWarning() {
  if (hasLoggedLegacyPersistenceMigrationWarning) {
    return;
  }

  hasLoggedLegacyPersistenceMigrationWarning = true;
  console.warn(
    '[Runtime] Skipping legacy execution persistence because agent_executions/tool_executions tables are not available. ' +
      'Tool audit logs continue in agent_tool_execution_logs.'
  );
}

/**
 * BlockOps Agent Runtime
 * Implements the Plan -> Execute -> Verify -> Decide (PEVD) loop with ERC-8004
 */
class BlockOpsAgentRuntime {
  constructor(agentId, options = {}) {
    this.agentId = agentId;
    this.provider = getProvider();
    this.wallet = options.privateKey ? new ethers.Wallet(options.privateKey, this.provider) : null;
    
    // Registry addresses from env
    this.identityAddr = process.env.IDENTITY_REGISTRY_ADDRESS;
    this.reputationAddr = process.env.REPUTATION_REGISTRY_ADDRESS;
    this.validationAddr = process.env.VALIDATION_REGISTRY_ADDRESS;
    
    this.orchestrator = new AgentOrchestrator();
    this.logs = [];
    this.reputationUpdated = false;
  }

  /**
   * Main entry point for the runtime loop
   */
  async run(userMessage, routingPlan, executionFn) {
    const runId = crypto.randomUUID();
    this.record('start', { runId, userMessage });

    try {
      // 1. IDENTITY: Ensure agent is registered on-chain
      const onChainId = await this.ensureIdentity();
      this.record('identity', { onChainId });

      // 2. ORCHESTRATION: Check if any tools in the plan are not handled by this agent
      // and need to be delegated to another registered agent via ERC-8004
      const delegations = await this.checkDelegations(routingPlan);
      if (delegations.length > 0) {
        this.record('orchestration', { delegations });
        // Enhance executionResult later with delegation info
      }

      // 3. EXECUTE: Run the provided execution function (AI or direct)
      const executionResult = await executionFn();
      
      // Merge delegations into results for visibility
      if (delegations.length > 0) {
        delegations.forEach(d => {
          executionResult.results.push({
            tool: d.tool,
            success: true,
            status: d.status,
            delegatedTo: d.delegatedTo,
            agent: d.agent,
            result: `Task delegated to trusted agent #${d.delegatedTo} (Score: ${d.agent.score})`
          });
        });
      }

      this.record('execute', { 
        tool_calls: executionResult.tool_calls, 
        results: executionResult.results 
      });

      // 3. VERIFY: Check all transaction receipts
      const verification = await this.verifyResults(onChainId, executionResult.results);
      this.record('verify', { verification });

      // 4. REPUTATION: Update on-chain trust score
      if (onChainId) {
        await this.updateReputation(onChainId, verification);
      }

      // 5. DECIDE: Determine final status
      const decision = this.decide(verification);
      this.record('decide', { decision });

      // 6. PERSIST: Save execution and tool results to database
      await this.persistExecution(userMessage, executionResult, verification, decision);

      return {
        runId,
        onChainId,
        decision,
        verification,
        results: executionResult.results,
        tool_calls: executionResult.tool_calls,
        agent_response: executionResult.agent_response,
        logs: this.logs
      };

    } catch (error) {
      console.error(`[Runtime] Error in agent ${this.agentId}:`, error);
      this.record('error', { message: error.message });
      throw error;
    }
  }

  /**
   * Ensures the agent has an ERC-8004 identity
   */
  async ensureIdentity() {
    if (!this.identityAddr || !this.wallet) return null;

    try {
      // Check if we already have an on-chain ID in Supabase
      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('on_chain_id')
        .eq('id', this.agentId)
        .single();

      if (agentError) {
        if (isMissingOnChainIdColumnError(agentError)) {
          console.warn(`[Runtime] ${getOnChainIdColumnMigrationMessage()}`);
          return null;
        }

        throw new Error(agentError.message);
      }

      if (agent?.on_chain_id) {
        return agent.on_chain_id;
      }

      // If not, register it now
      console.log(`[Runtime] Registering agent ${this.agentId} on-chain...`);
      const identityContract = new ethers.Contract(this.identityAddr, IDENTITY_ABI, this.wallet);
      
      const agentURI = `https://blockops.in/api/v1/agents/${this.agentId}/manifest`;
      const tx = await identityContract.registerAgent(this.wallet.address, agentURI);
      const receipt = await tx.wait();
      
      // Extract agentId from event
      const event = receipt.logs.find(log => log.fragment?.name === 'AgentRegistered');
      const onChainId = event?.args?.agentId;

      if (onChainId) {
        // Save to Supabase
        const { error: updateError } = await supabase
          .from('agents')
          .update({ on_chain_id: onChainId.toString() })
          .eq('id', this.agentId);

        if (updateError) {
          if (isMissingOnChainIdColumnError(updateError)) {
            throw new Error(`${getOnChainIdColumnMigrationMessage()} The agent was registered on-chain, but the ID could not be saved locally.`);
          }

          throw new Error(updateError.message);
        }
        
        return onChainId.toString();
      }
    } catch (err) {
      console.warn('[Runtime] Failed to ensure on-chain identity:', err.message);
    }
    return null;
  }

  /**
   * Verifies execution results on-chain
   */
  async verifyResults(onChainId, results) {
    const verifications = [];
    let allSucceeded = true;

    for (const result of results) {
      if (result.txHash) {
        try {
          const receipt = await this.provider.getTransactionReceipt(result.txHash);
          const success = receipt?.status === 1;
          if (!success) allSucceeded = false;

          let validationHash = null;

          // Post to Validation Registry if we have an on-chain ID
          if (onChainId && this.validationAddr && this.wallet) {
            try {
              const validationContract = new ethers.Contract(this.validationAddr, VALIDATION_ABI, this.wallet);
              validationHash = ethers.keccak256(ethers.toUtf8Bytes(result.txHash + Date.now()));
              
              await validationContract.validationRequest(
                this.wallet.address, // Validator is the operator for now
                onChainId,
                `ipfs://placeholder-${result.txHash}`,
                validationHash
              );
              console.log(`[Runtime] Validation request sent for ${result.txHash}: ${validationHash}`);
            } catch (vErr) {
              console.warn(`[Runtime] Validation request failed for ${result.txHash}:`, vErr.message);
            }
          }

          verifications.push({
            tool: result.tool,
            txHash: result.txHash,
            validationHash,
            success,
            blockNumber: receipt?.blockNumber
          });
        } catch (err) {
          console.warn(`[Runtime] Verification failed for ${result.txHash}:`, err.message);
          allSucceeded = false;
        }
      } else if (result.success === false) {
        allSucceeded = false;
      }
    }

    return { verifications, allSucceeded };
  }

  /**
   * Persists execution results to Supabase
   */
  async persistExecution(userMessage, executionResult, verification, decision) {
    if (!supabase) return;

    try {
      // 1. Get user_id for this agent
      const { data: agent } = await supabase
        .from('agents')
        .select('user_id')
        .eq('id', this.agentId)
        .single();

      if (!agent) return;

      // 2. Create agent_execution record
      const { data: execution, error: execError } = await supabase
        .from('agent_executions')
        .insert({
          agent_id: this.agentId,
          user_id: agent.user_id,
          user_message: userMessage,
          agent_response: executionResult.agent_response,
          tool_calls_count: executionResult.tool_calls?.length || 0,
          success: verification.allSucceeded,
          execution_time_ms: 0 // Placeholder
        })
        .select()
        .single();

      if (execError) {
        if (shouldSkipLegacyExecutionPersistence(execError)) {
          logLegacyPersistenceMigrationWarning();
          return;
        }
        throw execError;
      }

      // 3. Create tool_execution records
      const toolExecutions = executionResult.results.map(result => {
        const v = verification.verifications.find(v => v.txHash === result.txHash && v.tool === result.tool);
        return {
          execution_id: execution.id,
          tool_name: result.tool,
          parameters: result.parameters || {},
          result: result,
          success: result.success !== false && (v ? v.success : true),
          transaction_hash: result.txHash || null,
          validation_hash: v ? v.validationHash : null
        };
      });

      if (toolExecutions.length > 0) {
        const { error: toolError } = await supabase
          .from('tool_executions')
          .insert(toolExecutions);
        
        if (toolError) {
          if (shouldSkipLegacyExecutionPersistence(toolError)) {
            logLegacyPersistenceMigrationWarning();
            return;
          }
          throw toolError;
        }
      }

      console.log(`[Runtime] Execution persisted to database for run ${execution.id}`);
    } catch (err) {
      console.warn('[Runtime] Failed to persist execution:', err.message);
    }
  }

  /**
   * Updates agent reputation based on verification
   */
  async updateReputation(onChainId, verification) {
    if (!this.reputationAddr || !this.wallet) return;
    if (this.reputationUpdated) {
      console.warn(`[Runtime] Reputation already updated for agent ${onChainId} in this runtime instance. Skipping duplicate write.`);
      return;
    }

    try {
      const reputationContract = new ethers.Contract(this.reputationAddr, REPUTATION_ABI, this.wallet);
      const score = verification.allSucceeded ? 100 : 0;
      
      // Update successRate tag
      await reputationContract.giveFeedback(
        onChainId,
        score,
        0, // weight
        "successRate",
        "runtime-execution",
        ethers.ZeroHash
      );
      this.reputationUpdated = true;
      
      console.log(`[Runtime] Reputation updated for agent ${onChainId}: ${score}`);
    } catch (err) {
      console.warn('[Runtime] Failed to update reputation:', err.message);
    }
  }

  /**
   * Checks if any tools in the routing plan should be delegated
   */
  async checkDelegations(routingPlan) {
    const steps = routingPlan.execution_plan?.steps || [];
    const delegations = [];

    // Get this agent's enabled tools
    const { data: agent } = await supabase
      .from('agents')
      .select('enabled_tools')
      .eq('id', this.agentId)
      .single();

    const allowedTools = new Set(agent?.enabled_tools || []);

    for (const step of steps) {
      // If a tool is requested but not in this agent's allowed list, 
      // try to find another registered agent via ERC-8004
      if (!allowedTools.has(step.tool)) {
        try {
          const delegation = await this.orchestrator.delegateTask(
            { tool: step.tool, params: step.parameters },
            step.tool
          );
          delegations.push({
            tool: step.tool,
            delegatedTo: delegation.delegatedTo,
            status: delegation.status,
            agent: delegation.targetAgent
          });
        } catch (err) {
          if (/no trusted agents found/i.test(String(err.message || ''))) {
            console.log(`[Runtime] Delegation skipped for tool ${step.tool}: ${err.message}`);
          } else {
            console.warn(`[Runtime] Delegation failed for tool ${step.tool}:`, err.message);
          }
        }
      }
    }

    return delegations;
  }

  /**
   * Final decision based on verification
   */
  decide(verification) {
    if (verification.allSucceeded) {
      return { action: 'complete', status: 'success' };
    }
    return { action: 'complete', status: 'partial_failure' };
  }

  /**
   * Generates a standard agent.json manifest for DevSpot/ERC-8004
   */
  async generateManifest() {
    try {
      const { data: agent } = await supabase
        .from('agents')
        .select('*')
        .eq('id', this.agentId)
        .single();

      if (!agent) throw new Error('Agent not found');

      return {
        name: agent.name,
        version: "1.0.0",
        description: agent.description || "A trustless autonomous BlockOps agent",
        author: "BlockOps",
        homepage: "https://blockops.in",
        erc8004: {
          identityRegistry: `eip155:421614:${this.identityAddr}`,
          reputationRegistry: `eip155:421614:${this.reputationAddr}`,
          validationRegistry: `eip155:421614:${this.validationAddr}`,
          agentId: agent.on_chain_id || null,
          operatorWallet: agent.wallet_address || null
        },
        capabilities: agent.enabled_tools || [],
        trustModel: ["reputation", "crypto-economic"],
        paymentProtocol: "x402",
        paymentToken: "USDC",
        chain: {
          name: "Arbitrum Sepolia",
          chainId: 421614,
          explorer: "https://sepolia.arbiscan.io"
        }
      };
    } catch (err) {
      console.warn('[Runtime] Failed to generate manifest:', err.message);
      return null;
    }
  }

  /**
   * Exports the run logs as a standard agent_log.json
   */
  exportLogs() {
    return {
      agent: {
        id: this.agentId,
        onChainId: this.logs.find(l => l.phase === 'identity')?.onChainId || null,
        registry: `eip155:421614:${this.identityAddr}`
      },
      runs: this.logs,
      generated: new Date().toISOString()
    };
  }

  /**
   * Internal logging
   */
  record(phase, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      phase,
      ...data
    };
    this.logs.push(entry);
    console.log(`[Runtime][${phase}]`, JSON.stringify(data));
  }
}

module.exports = { BlockOpsAgentRuntime };

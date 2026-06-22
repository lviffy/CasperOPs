// Payment Service - Core payment verification and management
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// Types
export interface PaymentVerificationRequest {
  paymentHash: string;
  userId: string;
  agentId?: string;
  toolName?: string;
}

export interface PaymentVerificationResponse {
  verified: boolean;
  executionToken?: string;
  paymentId?: string;
  expiresAt?: Date;
  error?: string;
}

export interface PaymentStatus {
  id: string;
  status: 'pending' | 'confirmed' | 'executed' | 'refunded' | 'failed' | 'expired';
  amount: string;
  tokenSymbol: string;
  createdAt: Date;
  confirmedAt?: Date;
  executedAt?: Date;
}

// Payment Escrow ABI (minimal for verification)
const PAYMENT_ESCROW_ABI = [
  'function verifyPayment(bytes32 paymentId) external view returns (bool)',
  'function getPayment(bytes32 paymentId) external view returns (address user, uint256 amount, address token, string agentId, string toolName, uint256 timestamp, bool executed, bool refunded)',
  'function executePayment(bytes32 paymentId) external',
  'function refundPayment(bytes32 paymentId) external',
];

export class PaymentService {
  private supabase;
  private provider;
  private contract;
  private backendSigner;
  private jwtSecret: string;

  constructor() {
    // Initialize Supabase
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Initialize blockchain provider
    this.provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc'
    );

    // Initialize contract
    this.contract = new ethers.Contract(
      process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS!,
      PAYMENT_ESCROW_ABI,
      this.provider
    );

    // Initialize backend signer (for executing/refunding payments)
    this.backendSigner = new ethers.Wallet(
      process.env.PAYMENT_BACKEND_PRIVATE_KEY!,
      this.provider
    );

    // JWT secret for execution tokens
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-this';
  }

  /**
   * Verify payment on-chain and create execution token
   */
  async verifyPayment(
    request: PaymentVerificationRequest
  ): Promise<PaymentVerificationResponse> {
    try {
      const { paymentHash, userId, agentId, toolName } = request;

      // 1. Check if payment already exists in database
      const { data: existingPayment } = await this.supabase
        .from('payments')
        .select('*')
        .eq('payment_hash', paymentHash)
        .single();

      if (existingPayment) {
        // Payment already verified
        if (existingPayment.execution_token) {
          return {
            verified: true,
            executionToken: existingPayment.execution_token,
            paymentId: existingPayment.id,
            expiresAt: new Date(existingPayment.expires_at),
          };
        }
      }

      // 2. Verify payment on-chain
      const paymentId = ethers.keccak256(ethers.toUtf8Bytes(paymentHash));
      const isValid = await this.contract.verifyPayment(paymentId);

      if (!isValid) {
        return {
          verified: false,
          error: 'Payment not found or already processed on-chain',
        };
      }

      // 3. Get payment details from contract
      const paymentDetails = await this.contract.getPayment(paymentId);
      const [user, amount, token, agentIdOnChain, toolNameOnChain, timestamp, executed, refunded] = paymentDetails;

      // 4. Verify user matches
      if (user.toLowerCase() !== userId.toLowerCase()) {
        return {
          verified: false,
          error: 'Payment user mismatch',
        };
      }

      // 5. Generate execution token (JWT)
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      const executionToken = jwt.sign(
        {
          paymentHash,
          paymentId: paymentId,
          userId,
          agentId: agentId || agentIdOnChain,
          toolName: toolName || toolNameOnChain,
          amount: ethers.formatUnits(amount, 6), // Assuming USDC (6 decimals)
        },
        this.jwtSecret,
        { expiresIn: '30m' }
      );

      // 6. Get token symbol
      let tokenSymbol = 'ETH';
      if (token !== ethers.ZeroAddress) {
        try {
          const tokenContract = new ethers.Contract(
            token,
            ['function symbol() view returns (string)'],
            this.provider
          );
          tokenSymbol = await tokenContract.symbol();
        } catch (e) {
          tokenSymbol = 'USDC'; // Default to USDC
        }
      }

      // 7. Store payment in database
      const { data: payment, error: dbError } = await this.supabase
        .from('payments')
        .upsert({
          payment_hash: paymentHash,
          payment_id: paymentId,
          user_id: userId,
          agent_id: agentId,
          amount: ethers.formatUnits(amount, 6),
          token_address: token,
          token_symbol: tokenSymbol,
          tool_name: toolName || toolNameOnChain,
          status: 'confirmed',
          execution_token: executionToken,
          confirmed_at: new Date(),
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (dbError) {
        console.error('Database error:', dbError);
        return {
          verified: false,
          error: 'Failed to store payment',
        };
      }

      return {
        verified: true,
        executionToken,
        paymentId: payment.id,
        expiresAt,
      };
    } catch (error) {
      console.error('Payment verification error:', error);
      return {
        verified: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify execution token
   */
  verifyExecutionToken(token: string): { valid: boolean; payload?: any; error?: string } {
    try {
      const payload = jwt.verify(token, this.jwtSecret);
      return { valid: true, payload };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
    }
  }

  /**
   * Execute payment (release escrow to treasury)
   */
  async executePayment(paymentId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // 1. Get payment from database
      const { data: payment, error: dbError } = await this.supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (dbError || !payment) {
        return { success: false, error: 'Payment not found' };
      }

      if (payment.status !== 'confirmed') {
        return { success: false, error: 'Payment not in confirmed state' };
      }

      // 2. Execute payment on-chain
      const contractWithSigner = this.contract.connect(this.backendSigner) as any;
      const tx = await contractWithSigner.executePayment(payment.payment_id);
      const receipt = await tx.wait();

      // 3. Update database
      await this.supabase
        .from('payments')
        .update({
          status: 'executed',
          executed_at: new Date(),
          transaction_hash: receipt.hash,
        })
        .eq('id', paymentId);

      return {
        success: true,
        txHash: receipt.hash,
      };
    } catch (error) {
      console.error('Payment execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed',
      };
    }
  }

  /**
   * Refund payment (return funds to user)
   */
  async refundPayment(paymentId: string, reason: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      // 1. Get payment from database
      const { data: payment, error: dbError } = await this.supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (dbError || !payment) {
        return { success: false, error: 'Payment not found' };
      }

      if (payment.status === 'executed' || payment.status === 'refunded') {
        return { success: false, error: 'Payment already processed' };
      }

      // 2. Refund payment on-chain
      const contractWithSigner = this.contract.connect(this.backendSigner) as any;
      const tx = await contractWithSigner.refundPayment(payment.payment_id);
      const receipt = await tx.wait();

      // 3. Update database
      await this.supabase
        .from('payments')
        .update({
          status: 'refunded',
          refunded_at: new Date(),
          refund_hash: receipt.hash,
          metadata: {
            ...payment.metadata,
            refund_reason: reason,
          },
        })
        .eq('id', paymentId);

      return {
        success: true,
        txHash: receipt.hash,
      };
    } catch (error) {
      console.error('Payment refund error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Refund failed',
      };
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentHash: string): Promise<PaymentStatus | null> {
    try {
      const { data: payment } = await this.supabase
        .from('payments')
        .select('*')
        .eq('payment_hash', paymentHash)
        .single();

      if (!payment) return null;

      return {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        tokenSymbol: payment.token_symbol,
        createdAt: new Date(payment.created_at),
        confirmedAt: payment.confirmed_at ? new Date(payment.confirmed_at) : undefined,
        executedAt: payment.executed_at ? new Date(payment.executed_at) : undefined,
      };
    } catch (error) {
      console.error('Get payment status error:', error);
      return null;
    }
  }

  /**
   * Check AI generation quota
   */
  async checkAIQuota(userId: string): Promise<{
    canGenerate: boolean;
    freeRemaining: number;
    needsPayment: boolean;
  }> {
    try {
      const { data, error } = await this.supabase.rpc('check_ai_generation_quota', {
        p_user_id: userId,
        p_is_paid: false,
      });

      if (error) throw error;

      return {
        canGenerate: data[0].can_generate,
        freeRemaining: data[0].free_remaining,
        needsPayment: data[0].needs_payment,
      };
    } catch (error) {
      console.error('Check AI quota error:', error);
      return { canGenerate: false, freeRemaining: 0, needsPayment: true };
    }
  }

  /**
   * Increment AI generation usage
   */
  async incrementAIUsage(userId: string, isPaid: boolean = false): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc('increment_ai_generation', {
        p_user_id: userId,
        p_is_paid: isPaid,
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Increment AI usage error:', error);
      return false;
    }
  }

  /**
   * Get tool pricing
   */
  async getToolPricing(toolName: string): Promise<{
    price: number;
    isFree: boolean;
    displayName: string;
    description: string;
  } | null> {
    try {
      const { data: pricing } = await this.supabase
        .from('pricing_config')
        .select('*')
        .eq('tool_name', toolName)
        .eq('enabled', true)
        .single();

      if (!pricing) return null;

      return {
        price: parseFloat(pricing.price_usdc),
        isFree: pricing.is_free,
        displayName: pricing.display_name,
        description: pricing.description,
      };
    } catch (error) {
      console.error('Get tool pricing error:', error);
      return null;
    }
  }

  /**
   * Record payment agreement
   */
  async recordPaymentAgreement(
    userId: string,
    version: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase.from('payment_agreements').insert({
        user_id: userId,
        version,
        ip_address: ipAddress,
        user_agent: userAgent,
        terms_content: 'Payment terms v1.0', // You can customize this
      });

      return !error;
    } catch (error) {
      console.error('Record payment agreement error:', error);
      return false;
    }
  }

  /**
   * Check if user has agreed to payment terms
   */
  async hasAgreedToTerms(userId: string, version: string = 'v1.0'): Promise<boolean> {
    try {
      const { data } = await this.supabase
        .from('payment_agreements')
        .select('id')
        .eq('user_id', userId)
        .eq('version', version)
        .single();

      return !!data;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const paymentService = new PaymentService();

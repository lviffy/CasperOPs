// Payment Service - x402 payment verification and execution-token issuance.
//
// CasperOPs now uses Casper x402: the user signs a CEP-18 transfer deploy via
// CSPR.click and the backend verifies the deploy on-chain via CSPR.cloud,
// then issues a short-lived JWT the frontend sends back to invoke the paid
// tool. The old EVM payment-escrow contract is no longer required.

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from '@/lib/chains';
import { CLPublicKey } from 'casper-js-sdk';

export interface PaymentVerificationRequest {
  paymentHash: string;
  userId: string;
  agentId?: string;
  toolName?: string;
  amountCspr?: string;
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

const CSPR_DECIMALS = 9

function motesToCspr(motes: string | number | bigint): string {
  const m = typeof motes === 'bigint' ? motes : BigInt(motes || '0')
  const divisor = BigInt(10) ** BigInt(CSPR_DECIMALS)
  const whole = m / divisor
  const frac = m % divisor
  const fracStr = frac.toString().padStart(CSPR_DECIMALS, '0').replace(/0+$/, '')
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString()
}

async function verifyCasperDeploy(deployHash: string, expectedRecipient: string, minAmountCspr: string): Promise<{
  ok: boolean;
  error?: string;
  amount?: string;
}> {
  const cfg = CHAIN_CONFIGS[DEFAULT_CHAIN_ID]
  const base = cfg.csprCloudUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/deploys/${deployHash}`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      return { ok: false, error: `CSPR.cloud returned ${res.status}` }
    }
    const data: any = await res.json().catch(() => null)
    const deploy = data?.data ?? data
    if (!deploy) {
      return { ok: false, error: 'Deploy not found' }
    }
    
    // Check execution results for errors (handle nested Failure error message)
    const exec = deploy?.execution_result?.Executions?.[0] || deploy?.execution_results?.[0]
    const execFailure = exec?.result?.Failure || exec?.error_message;
    if (execFailure) {
      const errMsg = typeof execFailure === 'object' ? execFailure.error_message : String(execFailure);
      return { ok: false, error: `Deploy execution failed on-chain: ${errMsg}` }
    }
    
    const minMotes = BigInt(Math.round(parseFloat(minAmountCspr) * 10 ** CSPR_DECIMALS))
    let matched = BigInt(0)
    
    // 1. Try native transfers list
    const transfers: any[] = exec?.result?.Success?.transfers ?? []
    for (const t of transfers) {
      const to = String(t?.to ?? '')
      if (to.toLowerCase() === expectedRecipient.toLowerCase()) {
        try { matched += BigInt(t.amount) } catch { /* ignore */ }
      }
    }
    
    // 2. Fallback: Parse session arguments if no native transfers matched (CEP-18 token / native contract transfers)
    if (matched === BigInt(0)) {
      try {
        const session = deploy?.deploy?.session || deploy?.session;
        if (session) {
          const contractCall = session?.StoredContractByHash || 
                               session?.StoredContractByName || 
                               session?.StoredVersionedContractByHash || 
                               session?.StoredVersionedContractByName ||
                               session?.Transfer;
          const args = contractCall?.args || session?.args || session?.Transfer?.args;
          if (args) {
            let actualRecipient = "";
            let actualAmount = "";
            for (const arg of args) {
              const name = typeof arg[0] === 'string' ? arg[0] : arg?.[0]?.toString?.();
              if (name === 'recipient' || name === 'target') {
                const val = arg[1];
                const bytes = val?.bytes || val?.parsed?.bytes;
                if (bytes) {
                  const hex = Buffer.from(bytes, 'hex').toString('hex');
                  actualRecipient = hex.length === 64 ? '01' + hex : hex;
                } else if (val?.parsed) {
                  actualRecipient = typeof val.parsed === 'string' ? val.parsed : JSON.stringify(val.parsed);
                } else if (typeof val === 'string') {
                  actualRecipient = val;
                }
              }
              if (name === 'amount') {
                const val = arg[1];
                actualAmount = val?.parsed !== undefined ? String(val.parsed) : String(val);
              }
            }
            
            // Normalize and compare (recipient public key or derived account hash)
            let expectedRecipientHash = "";
            try {
              expectedRecipientHash = CLPublicKey.fromHex(expectedRecipient).toAccountHashStr();
            } catch { /* ignore */ }
            
            const cleanKey = (str: string) => {
              if (!str) return '';
              let cleaned = str.toLowerCase().replace(/^account-hash-/, '');
              if (cleaned.length === 66 && (cleaned.startsWith('01') || cleaned.startsWith('02'))) {
                cleaned = cleaned.slice(2);
              }
              return cleaned;
            };

            const normExpected = cleanKey(expectedRecipient);
            const normExpectedHash = cleanKey(expectedRecipientHash);
            const normActual = cleanKey(actualRecipient);
            
            if (
              (normActual === normExpected || (normExpectedHash && normActual === normExpectedHash)) && 
              actualAmount
            ) {
              matched = BigInt(actualAmount);
            }
          }
        }
      } catch (parseErr) {
        console.warn('[verifyCasperDeploy] session parse failed:', parseErr);
      }
    }
    
    if (matched < minMotes) {
      return { ok: false, error: `Payment of ${motesToCspr(matched)} CSPR is below required ${minAmountCspr} CSPR` }
    }
    return { ok: true, amount: motesToCspr(matched) }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'CSPR.cloud verification failed' }
  }
}

export class PaymentService {
  private _supabase: ReturnType<typeof createClient> | null = null
  private jwtSecret: string;
  private paymentRecipient: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'change-me-in-production';
    this.paymentRecipient =
      process.env.PAYMENT_RECIPIENT_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_PAYMENT_RECIPIENT_PUBLIC_KEY ||
      '';
  }

  private get supabase() {
    if (!this._supabase) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error('Missing Supabase environment variables');
      }
      this._supabase = createClient(url, key);
    }
    return this._supabase;
  }

  /**
   * Verify a x402 payment deploy on Casper and issue a short-lived JWT
   * the frontend can present to invoke the paid tool.
   */
  async verifyPayment(
    request: PaymentVerificationRequest
  ): Promise<PaymentVerificationResponse> {
    try {
      const { paymentHash, userId, agentId, toolName, amountCspr } = request;

      if (!paymentHash) {
        return { verified: false, error: 'paymentHash is required' };
      }

      // 1. Idempotent re-verification: if we already recorded this deploy, return the token.
      const { data: existingPayment } = await this.supabase
        .from('payments')
        .select('*')
        .eq('payment_hash', paymentHash)
        .maybeSingle();

      if (existingPayment?.execution_token) {
        return {
          verified: true,
          executionToken: existingPayment.execution_token,
          paymentId: existingPayment.id,
          expiresAt: new Date(existingPayment.expires_at),
        };
      }

      if (!this.paymentRecipient) {
        return { verified: false, error: 'PAYMENT_RECIPIENT_PUBLIC_KEY is not configured' };
      }

      const minAmount = amountCspr || process.env.DEFAULT_TOOL_PRICE_CSPR || '0.25';
      const verification = await verifyCasperDeploy(
        paymentHash,
        this.paymentRecipient,
        minAmount,
      );

      if (!verification.ok) {
        return { verified: false, error: verification.error || 'Payment verification failed' };
      }

      // 2. Issue JWT.
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const executionToken = jwt.sign(
        {
          paymentHash,
          paymentId: paymentHash,
          userId,
          agentId: agentId || null,
          toolName: toolName || null,
          amount: verification.amount || minAmount,
          network: CHAIN_CONFIGS[DEFAULT_CHAIN_ID].chainName,
        },
        this.jwtSecret,
        { expiresIn: '30m' },
      );

      // 3. Persist.
      const { data: payment, error: dbError } = await this.supabase
        .from('payments')
        .upsert({
          payment_hash: paymentHash,
          payment_id: paymentHash,
          user_id: userId,
          agent_id: agentId || null,
          amount: verification.amount || minAmount,
          token_address: this.paymentRecipient,
          token_symbol: 'CSPR',
          tool_name: toolName || null,
          status: 'confirmed',
          execution_token: executionToken,
          confirmed_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (dbError) {
        console.error('Database error:', dbError);
        return { verified: false, error: 'Failed to store payment' };
      }

      return {
        verified: true,
        executionToken,
        paymentId: payment?.id,
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
   * Validate an execution JWT and return its payload.
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
   * Mark a payment as executed (the tool was successfully run). x402 settles
   * the funds via the original CEP-18 transfer; no further on-chain action is
   * needed.
   */
  async executePayment(paymentId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
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

      await this.supabase
        .from('payments')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

      return { success: true, txHash: payment.payment_hash };
    } catch (error) {
      console.error('Payment execution error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Execution failed' };
    }
  }

  /**
   * Refund a payment by writing a refund note to the database. The actual
   * CSPR refund deploy is initiated by the operator manually; this method
   * records the refund reason.
   */
  async refundPayment(paymentId: string, reason: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
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

      await this.supabase
        .from('payments')
        .update({
          status: 'refunded',
          refunded_at: new Date().toISOString(),
          metadata: {
            ...(payment.metadata || {}),
            refund_reason: reason,
          },
        })
        .eq('id', paymentId);

      return { success: true };
    } catch (error) {
      console.error('Payment refund error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Refund failed' };
    }
  }

  async getPaymentStatus(paymentHash: string): Promise<PaymentStatus | null> {
    try {
      const { data: payment } = await this.supabase
        .from('payments')
        .select('*')
        .eq('payment_hash', paymentHash)
        .maybeSingle();

      if (!payment) return null;

      return {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        tokenSymbol: payment.token_symbol || 'CSPR',
        createdAt: new Date(payment.created_at),
        confirmedAt: payment.confirmed_at ? new Date(payment.confirmed_at) : undefined,
        executedAt: payment.executed_at ? new Date(payment.executed_at) : undefined,
      };
    } catch (error) {
      console.error('Get payment status error:', error);
      return null;
    }
  }

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
      const row = Array.isArray(data) ? data[0] : data;
      return {
        canGenerate: Boolean(row?.can_generate ?? row?.canGenerate),
        freeRemaining: Number(row?.free_remaining ?? row?.freeRemaining ?? 0),
        needsPayment: Boolean(row?.needs_payment ?? row?.needsPayment),
      };
    } catch (error) {
      console.error('Check AI quota error:', error);
      return { canGenerate: false, freeRemaining: 0, needsPayment: true };
    }
  }

  async incrementAIUsage(userId: string, isPaid: boolean = false): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc('increment_ai_generation', {
        p_user_id: userId,
        p_is_paid: isPaid,
      });

      if (error) throw error;
      return Boolean(data);
    } catch (error) {
      console.error('Increment AI usage error:', error);
      return false;
    }
  }

  async getToolPricing(toolName: string): Promise<{
    price: number;
    isFree: boolean;
    displayName: string;
    description: string;
    symbol?: string;
  } | null> {
    try {
      const { data: pricing } = await this.supabase
        .from('pricing_config')
        .select('*')
        .eq('tool_name', toolName)
        .eq('enabled', true)
        .maybeSingle();

      if (!pricing) return null;

      return {
        price: parseFloat(pricing.price_cspr ?? pricing.price_usdc ?? '0'),
        isFree: Boolean(pricing.is_free),
        displayName: pricing.display_name,
        description: pricing.description,
        symbol: pricing.token_symbol || 'CSPR',
      };
    } catch (error) {
      console.error('Get tool pricing error:', error);
      return null;
    }
  }

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
        terms_content: 'Payment terms v1.0',
      });

      return !error;
    } catch (error) {
      console.error('Record payment agreement error:', error);
      return false;
    }
  }

  async hasAgreedToTerms(userId: string, version: string = 'v1.0'): Promise<boolean> {
    try {
      const { data } = await this.supabase
        .from('payment_agreements')
        .select('id')
        .eq('user_id', userId)
        .eq('version', version)
        .maybeSingle();

      return Boolean(data);
    } catch (error) {
      return false;
    }
  }
}

export const paymentService = new PaymentService();

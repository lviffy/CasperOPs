// API Route: Execute payment (release escrow)
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paymentId, executionToken } = body;

    // Validate input
    if (!paymentId || !executionToken) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify execution token
    const tokenVerification = paymentService.verifyExecutionToken(executionToken);
    if (!tokenVerification.valid) {
      return NextResponse.json(
        { error: 'Invalid or expired execution token' },
        { status: 401 }
      );
    }

    // Execute payment
    const result = await paymentService.executePayment(paymentId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Payment execution failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error) {
    console.error('Execute payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

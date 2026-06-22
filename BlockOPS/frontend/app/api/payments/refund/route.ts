// API Route: Refund payment
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paymentId, reason, executionToken } = body;

    // Validate input
    if (!paymentId || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify execution token (backend authentication)
    if (executionToken) {
      const tokenVerification = paymentService.verifyExecutionToken(executionToken);
      if (!tokenVerification.valid) {
        return NextResponse.json(
          { error: 'Invalid or expired execution token' },
          { status: 401 }
        );
      }
    }

    // Refund payment
    const result = await paymentService.refundPayment(paymentId, reason);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Payment refund failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
    });
  } catch (error) {
    console.error('Refund payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

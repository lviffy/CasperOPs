// API Route: Verify payment and get execution token
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paymentHash, userId, agentId, toolName } = body;

    // Validate input
    if (!paymentHash || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify payment
    const result = await paymentService.verifyPayment({
      paymentHash,
      userId,
      agentId,
      toolName,
    });

    if (!result.verified) {
      return NextResponse.json(
        { error: result.error || 'Payment verification failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      executionToken: result.executionToken,
      paymentId: result.paymentId,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const paymentHash = searchParams.get('paymentHash');

    if (!paymentHash) {
      return NextResponse.json(
        { error: 'Payment hash required' },
        { status: 400 }
      );
    }

    const status = await paymentService.getPaymentStatus(paymentHash);

    if (!status) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ payment: status });
  } catch (error) {
    console.error('Get payment status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// API Route: Check AI generation quota
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    const quota = await paymentService.checkAIQuota(userId);

    return NextResponse.json({
      canGenerate: quota.canGenerate,
      freeRemaining: quota.freeRemaining,
      freeLimit: 3, // Daily free generation limit
      needsPayment: quota.needsPayment,
    });
  } catch (error) {
    console.error('Check AI quota error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, isPaid } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    const success = await paymentService.incrementAIUsage(userId, isPaid || false);

    if (!success) {
      return NextResponse.json(
        { error: 'Quota exceeded or update failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Increment AI usage error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

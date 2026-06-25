// API Route: Payment agreement
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, version = 'v1.0' } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    // Get IP address and user agent
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const success = await paymentService.recordPaymentAgreement(
      userId,
      version,
      ipAddress,
      userAgent
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to record agreement' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Record payment agreement error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const version = searchParams.get('version') || 'v1.0';

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    const hasAgreed = await paymentService.hasAgreedToTerms(userId, version);

    return NextResponse.json({ hasAgreed });
  } catch (error) {
    console.error('Check payment agreement error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

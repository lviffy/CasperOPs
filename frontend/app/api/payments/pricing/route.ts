// API Route: Get tool pricing
import { NextRequest, NextResponse } from 'next/server';
import { paymentService } from '@/lib/payment/payment-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const toolName = searchParams.get('toolName');

    if (!toolName) {
      return NextResponse.json(
        { error: 'Tool name required' },
        { status: 400 }
      );
    }

    const pricing = await paymentService.getToolPricing(toolName);

    if (!pricing) {
      return NextResponse.json(
        { error: 'Tool pricing not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(pricing);
  } catch (error) {
    console.error('Get tool pricing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

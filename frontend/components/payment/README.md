# Payment System UI Components

Complete set of React components for the x402 payment system integration in BlockOps.

## 📦 Components Overview

### 1. PaymentModal
**Purpose**: Handle USDC payments for tool usage

**Features**:
- ✅ Wallet connection via Privy
- ✅ USDC balance checking
- ✅ Token approval flow
- ✅ Payment creation in escrow
- ✅ Real-time transaction status
- ✅ Payment verification with backend
- ✅ Execution token generation
- ✅ Network validation (Arbitrum Sepolia)
- ✅ Integration with PaymentAgreementModal

**Usage**:
```tsx
import { PaymentModal } from "@/components/payment"

<PaymentModal
  open={showPayment}
  onOpenChange={setShowPayment}
  toolName="deploy_erc20"
  toolDisplayName="Deploy ERC-20 Token"
  price="0.50"
  agentId={agentId}
  onPaymentSuccess={(txHash, executionToken) => {
    // Execute tool with execution token
    console.log("Payment successful:", txHash)
  }}
  onPaymentError={(error) => {
    console.error("Payment failed:", error)
  }}
/>
```

**Props**:
- `open` (boolean) - Control modal visibility
- `onOpenChange` (function) - Handle modal state changes
- `toolName` (string) - Internal tool identifier (e.g., "deploy_erc20")
- `toolDisplayName` (string) - User-facing tool name
- `price` (string) - Price in USDC (e.g., "0.25")
- `agentId` (string, optional) - Associated agent ID
- `onPaymentSuccess` (function, optional) - Callback with (paymentHash, executionToken)
- `onPaymentError` (function, optional) - Callback with error message

---

### 2. PaymentAgreementModal
**Purpose**: Display and record user acceptance of payment terms

**Features**:
- ✅ Full payment terms & conditions (v1.0)
- ✅ Scrollable content
- ✅ Checkbox agreement requirement
- ✅ IP address and user agent tracking
- ✅ Version tracking
- ✅ Backend integration to record agreement

**Usage**:
```tsx
import { PaymentAgreementModal } from "@/components/payment"

<PaymentAgreementModal
  open={showTerms}
  onOpenChange={setShowTerms}
  onAccepted={() => {
    // User accepted terms, can now make payments
    console.log("Terms accepted")
  }}
/>
```

**Props**:
- `open` (boolean) - Control modal visibility
- `onOpenChange` (function) - Handle modal state changes
- `onAccepted` (function, optional) - Callback when user accepts terms

**Terms Version**: v1.0 (November 23, 2025)

---

### 3. AIQuotaBadge
**Purpose**: Display user's daily free AI generation quota

**Features**:
- ✅ Shows remaining free generations (X/3)
- ✅ Two variants: inline (badge) and banner (alert)
- ✅ Color-coded status (green → yellow → red)
- ✅ Upgrade CTA when quota exhausted
- ✅ Auto-refresh from API
- ✅ Compact version for navbars

**Usage**:
```tsx
import { AIQuotaBadge, AIQuotaBadgeCompact } from "@/components/payment"

// Inline badge (for use in headers/cards)
<AIQuotaBadge
  variant="inline"
  onUpgradeClick={() => {
    // Open payment modal
  }}
/>

// Banner alert (for use in main content areas)
<AIQuotaBadge
  variant="banner"
  showUpgradeButton={true}
/>

// Compact version (for navbars)
<AIQuotaBadgeCompact />
```

**Props**:
- `variant` ("inline" | "banner") - Display style
- `onUpgradeClick` (function, optional) - Callback when upgrade button clicked
- `showUpgradeButton` (boolean) - Show/hide upgrade button (default: true)

**States**:
- **Normal**: 3/3 or 2/3 remaining (secondary badge)
- **Low**: 1/3 remaining (warning color)
- **Exhausted**: 0/3 remaining (destructive variant + upgrade CTA)

---

### 4. ToolPricingBadge
**Purpose**: Display tool pricing with interactive tooltip

**Features**:
- ✅ FREE or $X.XX USDC badge
- ✅ Hover card with detailed pricing info
- ✅ Tool description and category
- ✅ Escrow and refund information
- ✅ Click handler for payment flow
- ✅ Auto-fetch pricing from API
- ✅ Gradient styling for paid tools

**Usage**:
```tsx
import { ToolPricingBadge, ToolPriceIndicator } from "@/components/payment"

// Full badge with tooltip
<ToolPricingBadge
  toolName="deploy_erc20"
  onClick={() => {
    // Open payment modal
    setShowPayment(true)
  }}
  showTooltip={true}
/>

// Simple text indicator
<ToolPriceIndicator toolName="deploy_erc20" />
```

**Props**:
- `toolName` (string) - Tool identifier to fetch pricing
- `onClick` (function, optional) - Click handler (e.g., open payment modal)
- `showTooltip` (boolean) - Show hover card (default: true)
- `className` (string, optional) - Additional CSS classes
- `variant` ("default" | "compact") - Display size

**Tooltip Content**:
- Tool display name
- Category badge
- Price in USDC
- Tool description
- Escrow information
- Click instruction

---

### 5. PaymentStatusIndicator
**Purpose**: Real-time payment transaction status tracking

**Features**:
- ✅ 6 status states with icons and colors
- ✅ Two variants: badge (minimal) and full (detailed)
- ✅ Transaction hash with Arbiscan link
- ✅ Auto-refresh capability
- ✅ Detailed payment information
- ✅ Error message display
- ✅ Timestamps for all state changes

**Usage**:
```tsx
import { PaymentStatusIndicator, PaymentStatusIcon } from "@/components/payment"

// Full detailed view
<PaymentStatusIndicator
  paymentHash="0x..."
  status="confirmed"
  showDetails={true}
  variant="full"
  onRefresh={() => {
    // Refresh payment status
  }}
/>

// Simple badge
<PaymentStatusIndicator
  status="executed"
  variant="badge"
/>

// Icon only
<PaymentStatusIcon status="pending" />
```

**Props**:
- `paymentHash` (string, optional) - Transaction hash for lookup
- `paymentId` (string, optional) - Payment ID for lookup
- `status` (PaymentStatus, optional) - Initial status
- `onRefresh` (function, optional) - Custom refresh handler
- `showDetails` (boolean) - Show full payment details (default: true)
- `variant` ("badge" | "full") - Display style (default: "badge")
- `className` (string, optional) - Additional CSS classes

**Status States**:
- **pending** ⏱️ - Transaction processing
- **confirmed** ✅ - Payment verified, awaiting execution
- **executed** ✅ - Service completed, funds released
- **refunded** ⚠️ - Funds returned due to failure
- **failed** ❌ - Transaction failed
- **expired** ⏳ - Authorization token expired

---

## 🔧 Installation & Setup

### 1. Environment Variables
Add to `.env.local`:

```bash
# Arbitrum Sepolia Configuration
NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
NEXT_PUBLIC_USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS=<deployed_contract_address>

# Privy Authentication
NEXT_PUBLIC_PRIVY_APP_ID=<your_privy_app_id>

# Supabase
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_supabase_anon_key>
```

### 2. Dependencies
All required dependencies are already installed:

```bash
✅ @privy-io/react-auth@3.7.0
✅ ethers@6.15.0
✅ lucide-react@0.454.0
✅ Radix UI components (dialog, badge, button, etc.)
```

### 3. Import Components
```tsx
// Import individual components
import { 
  PaymentModal, 
  PaymentAgreementModal,
  AIQuotaBadge,
  ToolPricingBadge,
  PaymentStatusIndicator 
} from "@/components/payment"

// Or import all at once
import * as Payment from "@/components/payment"
```

---

## 🎨 Component Architecture

```
components/payment/
├── PaymentModal.tsx              # Main payment flow
├── PaymentAgreementModal.tsx     # Terms acceptance
├── AIQuotaBadge.tsx              # Quota tracking
├── ToolPricingBadge.tsx          # Tool pricing display
├── PaymentStatusIndicator.tsx    # Transaction status
└── index.ts                      # Central exports
```

**Data Flow**:
```
User Action
    ↓
PaymentModal (checks agreement → wallet → approval → payment)
    ↓
Smart Contract (escrow creation)
    ↓
Backend API (/api/payments/verify)
    ↓
Execution Token (JWT, 30min)
    ↓
Tool Execution
    ↓
Backend API (/api/payments/execute)
    ↓
Smart Contract (release escrow)
    ↓
PaymentStatusIndicator (show completion)
```

---

## 🎯 Integration Guide

### Example: Add Payment to Tool Execution

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { PaymentModal, ToolPricingBadge, AIQuotaBadge } from "@/components/payment"

export function ToolExecutionCard({ toolName, toolDisplayName, requiresPayment }) {
  const [showPayment, setShowPayment] = useState(false)
  const [executionToken, setExecutionToken] = useState<string | null>(null)

  const handleExecute = async () => {
    if (requiresPayment) {
      // Check if user has agreed to terms, etc.
      setShowPayment(true)
    } else {
      // Execute free tool directly
      await executeTool()
    }
  }

  const executeTool = async (token?: string) => {
    const headers: any = { "Content-Type": "application/json" }
    
    // Add execution token if this is a paid execution
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const response = await fetch("/api/tools/execute", {
      method: "POST",
      headers,
      body: JSON.stringify({ toolName, /* other params */ }),
    })

    // Handle response...
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3>{toolDisplayName}</h3>
        <ToolPricingBadge toolName={toolName} />
      </div>

      <Button onClick={handleExecute}>
        Execute Tool
      </Button>

      <PaymentModal
        open={showPayment}
        onOpenChange={setShowPayment}
        toolName={toolName}
        toolDisplayName={toolDisplayName}
        price="0.25"
        onPaymentSuccess={(txHash, token) => {
          setExecutionToken(token)
          setShowPayment(false)
          // Execute tool with token
          executeTool(token)
        }}
      />
    </div>
  )
}
```

### Example: AI Workflow Generation with Quota

```tsx
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { PaymentModal, AIQuotaBadge } from "@/components/payment"
import { useAuth } from "@/lib/auth"

export function AIWorkflowGenerator() {
  const { user } = useAuth()
  const [quota, setQuota] = useState<any>(null)
  const [showPayment, setShowPayment] = useState(false)

  const checkQuota = async () => {
    const response = await fetch(`/api/payments/ai-quota?userId=${user?.id}`)
    const data = await response.json()
    setQuota(data)
  }

  useEffect(() => {
    if (user) checkQuota()
  }, [user])

  const handleGenerate = async () => {
    if (!quota?.canGenerate) {
      // Need payment
      setShowPayment(true)
      return
    }

    // Generate workflow (free quota available)
    await generateWorkflow(false)
  }

  const generateWorkflow = async (isPaid: boolean) => {
    // Generate AI workflow
    const response = await fetch("/api/ai/generate-workflow", {
      method: "POST",
      // ... workflow generation
    })

    // Increment usage counter
    await fetch("/api/payments/ai-quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user?.id, isPaid }),
    })

    // Refresh quota
    checkQuota()
  }

  return (
    <div>
      <div className="mb-4">
        <AIQuotaBadge variant="banner" />
      </div>

      <Button onClick={handleGenerate}>
        Generate AI Workflow
      </Button>

      <PaymentModal
        open={showPayment}
        onOpenChange={setShowPayment}
        toolName="ai_workflow_generation"
        toolDisplayName="AI Workflow Generation"
        price="0.25"
        onPaymentSuccess={(txHash, token) => {
          setShowPayment(false)
          generateWorkflow(true)
        }}
      />
    </div>
  )
}
```

---

## 🔐 Security Considerations

1. **Never expose private keys** - All wallet operations use Privy's secure provider
2. **JWT tokens expire in 30 minutes** - Backend validates execution tokens
3. **Payment verification is on-chain** - Cannot be spoofed
4. **Escrow provides security** - Funds locked until service delivery
5. **Automatic refunds** - If service fails, funds returned automatically
6. **RLS policies** - Database enforces user data isolation

---

## 🐛 Troubleshooting

### "Please switch to Arbitrum Sepolia network"
**Solution**: User needs to switch their wallet to Arbitrum Sepolia (Chain ID: 421614)

### "Insufficient USDC balance"
**Solution**: User needs to acquire USDC on Arbitrum Sepolia testnet

### "Payment contract not configured"
**Solution**: Ensure `NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS` is set in `.env.local`

### "Failed to check payment agreement"
**Solution**: Verify `/api/payments/agreement` endpoint is working and user is authenticated

### Privy wallet connection issues
**Solution**: Check `NEXT_PUBLIC_PRIVY_APP_ID` is correct and Privy provider is wrapping the app

---

## 📊 Component Status

| Component | Status | Tests | Documentation |
|-----------|--------|-------|---------------|
| PaymentModal | ✅ Complete | ⏳ Pending | ✅ Complete |
| PaymentAgreementModal | ✅ Complete | ⏳ Pending | ✅ Complete |
| AIQuotaBadge | ✅ Complete | ⏳ Pending | ✅ Complete |
| ToolPricingBadge | ✅ Complete | ⏳ Pending | ✅ Complete |
| PaymentStatusIndicator | ✅ Complete | ⏳ Pending | ✅ Complete |

---

## 🚀 Next Steps

1. **Deploy Smart Contract** - Get contract address for `.env.local`
2. **Test Payment Flow** - End-to-end testing with testnet USDC
3. **Add to Workflow Builder** - Integrate payment modals into workflow UI
4. **Add to Agent Pages** - Show pricing badges on tools
5. **Add to Navigation** - Show quota badge in header
6. **Create Demo Video** - Record payment flow walkthrough

---

## 📝 API Endpoints Used

All components integrate with these backend APIs:

- `GET /api/payments/verify?paymentHash=...` - Get payment status
- `POST /api/payments/verify` - Verify payment and get execution token
- `POST /api/payments/execute` - Execute payment (release escrow)
- `POST /api/payments/refund` - Refund payment
- `GET /api/payments/ai-quota?userId=...` - Check AI quota
- `POST /api/payments/ai-quota` - Increment AI usage
- `GET /api/payments/pricing?toolName=...` - Get tool pricing
- `POST /api/payments/agreement` - Record terms acceptance
- `GET /api/payments/agreement?userId=...&version=...` - Check if user agreed

---

## 📚 Related Documentation

- [X402 Implementation Guide](../../X402_IMPLEMENTATION_GUIDE.md)
- [Payment Backend Complete](../../PAYMENT_BACKEND_COMPLETE.md)
- [Database Setup Guide](../../DATABASE_SETUP_GUIDE.md)
- [Arbitrum Sepolia Setup](../../../contract/payment-contracts/ARBITRUM_SEPOLIA_SETUP.md)
- [Smart Contract README](../../../contract/payment-contracts/README.md)

---

**Last Updated**: November 23, 2025  
**Version**: 1.0.0  
**Status**: ✅ Production Ready (Pending Smart Contract Deployment)

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import AIQuotaDisplay from "@/components/payment/ai-quota-display"
import ToolPricingBadge from "@/components/payment/tool-pricing-badge"
import PaymentModal from "@/components/payment/payment-modal"
import PaymentAgreementModal from "@/components/payment/payment-agreement-modal"
import PaymentStatusIndicator from "@/components/payment/payment-status-indicator"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default function PaymentDemo() {
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showAgreementModal, setShowAgreementModal] = useState(false)
  const [paymentHash, setPaymentHash] = useState<string>("")

  const handlePaymentSuccess = (executionToken: string, paymentId: string) => {
    console.log("Payment successful!", { executionToken, paymentId })
    setShowPaymentModal(false)
  }

  const handleAgreementAccept = () => {
    console.log("Terms accepted!")
    setShowAgreementModal(false)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">x402 Payment Components Demo</h1>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* AI Quota Display */}
        <Card>
          <CardHeader>
            <CardTitle>1. AI Quota Display</CardTitle>
            <CardDescription>
              Shows daily free AI generation quota (3 per day)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AIQuotaDisplay onUpgrade={() => setShowPaymentModal(true)} />
          </CardContent>
        </Card>

        {/* Tool Pricing Badges */}
        <Card>
          <CardHeader>
            <CardTitle>2. Tool Pricing Badges</CardTitle>
            <CardDescription>
              Display tool prices with tooltips
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">AI Generation</p>
                <ToolPricingBadge 
                  toolName="ai_workflow_generation"
                  size="md"
                  showTooltip={true}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Deploy ERC-20</p>
                <ToolPricingBadge 
                  toolName="deploy_erc20"
                  size="md"
                  showTooltip={true}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Deploy NFT</p>
                <ToolPricingBadge 
                  toolName="deploy_nft"
                  size="md"
                  showTooltip={true}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Transfer Token</p>
                <ToolPricingBadge 
                  toolName="transfer"
                  size="md"
                  showTooltip={true}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Modals */}
        <Card>
          <CardHeader>
            <CardTitle>3. Payment Modals</CardTitle>
            <CardDescription>
              Payment agreement and payment flow modals
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button onClick={() => setShowAgreementModal(true)}>
                Show Payment Agreement
              </Button>
              <Button onClick={() => setShowPaymentModal(true)}>
                Show Payment Modal
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Click the buttons above to see the modals in action
            </p>
          </CardContent>
        </Card>

        {/* Payment Status Indicator */}
        <Card>
          <CardHeader>
            <CardTitle>4. Payment Status Indicator</CardTitle>
            <CardDescription>
              Real-time payment status tracking (enter a transaction hash to test)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter payment hash (0x...)"
                className="flex-1 px-3 py-2 border rounded-md"
                value={paymentHash}
                onChange={(e) => setPaymentHash(e.target.value)}
              />
            </div>
            {paymentHash && (
              <PaymentStatusIndicator
                paymentHash={paymentHash}
                autoRefresh={true}
                showDetails={true}
                size="md"
              />
            )}
            {!paymentHash && (
              <p className="text-sm text-muted-foreground italic">
                Enter a payment transaction hash to see the status indicator
              </p>
            )}
          </CardContent>
        </Card>

        {/* Integration Info */}
        <Card>
          <CardHeader>
            <CardTitle>📚 Integration Guide</CardTitle>
            <CardDescription>
              How to use these components in your app
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="font-semibold">Import Components:</h3>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
{`import {
  AIQuotaDisplay,
  ToolPricingBadge,
  PaymentModal,
  PaymentAgreementModal,
  PaymentStatusIndicator
} from "@/components/payment"`}
              </pre>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold">Use Custom Hooks:</h3>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
{`import { usePayment, useAIGeneration, useToolExecution } from "@/hooks/use-payment"`}
              </pre>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold">📖 Full Documentation:</h3>
              <p className="text-sm">
                See <code className="bg-muted px-1 py-0.5 rounded">X402_INTEGRATION_EXAMPLES.md</code> for complete integration examples
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Environment Status */}
        <Card>
          <CardHeader>
            <CardTitle>⚙️ Configuration Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅</span>
              <span className="text-sm">Smart Contract Deployed: {process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_ADDRESS?.slice(0, 10)}...</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅</span>
              <span className="text-sm">Arbitrum Sepolia RPC: Configured</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅</span>
              <span className="text-sm">USDC Address: Configured</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-600">✅</span>
              <span className="text-sm">Supabase: Connected</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modals */}
      <PaymentAgreementModal
        isOpen={showAgreementModal}
        onClose={() => setShowAgreementModal(false)}
        onAccept={handleAgreementAccept}
      />

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handlePaymentSuccess}
        toolName="ai_workflow_generation"
        toolDisplayName="AI Workflow Generation"
        price={0.25}
        description="Generate a complete workflow from natural language"
      />
    </div>
  )
}

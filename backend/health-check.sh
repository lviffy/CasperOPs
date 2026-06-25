#!/bin/bash

# Backend Health Check Script
# Run this to verify your backend is properly configured

echo "🔍 n8nrollup Backend Health Check"
echo "=================================="
echo ""

# Check if server is running
echo "1️⃣  Checking if server is running..."
response=$(curl -s http://localhost:3000/health)

if [ -z "$response" ]; then
    echo "❌ Server is not running!"
    echo "   Start it with: npm start"
    exit 1
fi

echo "✅ Server is running"
echo ""

# Parse and display health info
echo "2️⃣  Server Configuration:"
echo "$response" | jq '.' 2>/dev/null || echo "$response"
echo ""

# Check if contracts are configured
token_factory=$(echo "$response" | jq -r '.tokenFactory' 2>/dev/null)
nft_factory=$(echo "$response" | jq -r '.nftFactory' 2>/dev/null)

echo "3️⃣  Contract Addresses:"
if [ "$token_factory" = "0x0000000000000000000000000000000000000000" ]; then
    echo "⚠️  TokenFactory not configured"
else
    echo "✅ TokenFactory: $token_factory"
fi

if [ "$nft_factory" = "0x0000000000000000000000000000000000000000" ]; then
    echo "⚠️  NFTFactory not configured"
else
    echo "✅ NFTFactory: $nft_factory"
fi
echo ""

# Summary
echo "=================================="
echo "📋 Summary:"
echo ""
if [ "$token_factory" = "0x0000000000000000000000000000000000000000" ] || [ "$nft_factory" = "0x0000000000000000000000000000000000000000" ]; then
    echo "⚠️  Setup incomplete"
    echo "   Please deploy Stylus contracts and update .env"
    echo "   See DEPLOYMENT_GUIDE.md for instructions"
else
    echo "✅ Backend is properly configured!"
    echo "   Ready to deploy tokens and NFTs"
fi
echo ""
echo "Available endpoints:"
echo "  POST /deploy-token"
echo "  POST /deploy-nft-collection"
echo "  POST /mint-nft"
echo "  POST /transfer"
echo "  GET  /balance/:address"
echo "  GET  /token-info/:address"
echo ""

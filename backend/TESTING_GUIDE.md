# Testing Guide - Complete Backend System

## 🧪 Testing Overview

This guide shows you how to test the complete backend system with both the AI Agent Layer and Blockchain Layer.

---

## 📋 Prerequisites

### 1. Install Dependencies

**Backend (Blockchain Layer):**
```bash
cd backend
npm install
```

**n8n_agent_backend (AI Layer):**
```bash
cd n8n_agent_backend
pip install -r requirements.txt
```

### 2. Configure Environment Variables

**backend/.env:**
```env
PORT=3000
TOKEN_FACTORY_ADDRESS=0xYourDeployedTokenFactoryAddress
NFT_FACTORY_ADDRESS=0xYourDeployedNFTFactoryAddress
GEMINI_API_KEY=your_gemini_api_key
```

**n8n_agent_backend/.env:**
```env
GEMINI_API_KEY=your_gemini_api_key
BACKEND_URL=http://localhost:3000
```

### 3. Get Test Wallet

You'll need:
- A wallet private key with 0x prefix
- Some Arbitrum Sepolia ETH for gas fees
- Get testnet ETH from: https://faucet.quicknode.com/arbitrum/sepolia

---

## 🚀 Start Both Servers

### Terminal 1: Start Blockchain Backend
```bash
cd backend
npm start
```

Expected output:
```
==================================================
🚀 n8nrollup Backend Server
==================================================
📡 Server running on port 3000
🌐 Network: Arbitrum Sepolia
🏭 TokenFactory: 0xYourAddress
🎨 NFTFactory: 0xYourAddress
```

### Terminal 2: Start AI Agent Backend
```bash
cd n8n_agent_backend
python main.py
```

Expected output:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

---

## ✅ Test 1: Health Checks

### Test Blockchain Backend
```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-11-23T10:30:00.000Z",
    "network": "Arbitrum Sepolia",
    "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
    "contracts": {
      "tokenFactory": "0xYourAddress",
      "nftFactory": "0xYourAddress"
    }
  }
}
```

### Test AI Agent Backend
```bash
curl http://localhost:8000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "AI Agent Builder",
  "blockchain": "Arbitrum Sepolia",
  "ai_model": "Google Gemini 2.0 Flash",
  "backend_url": "http://localhost:3000"
}
```

---

## ✅ Test 2: Direct Blockchain Operations (No AI)

### Deploy Token Directly
```bash
curl -X POST http://localhost:3000/token/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "0xYourPrivateKey",
    "name": "TestToken",
    "symbol": "TEST",
    "initialSupply": "1000000",
    "decimals": 18
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "message": "Token deployed successfully via Stylus TokenFactory",
    "tokenId": "0",
    "factoryAddress": "0xFactoryAddress",
    "transactionHash": "0xTransactionHash",
    "blockNumber": 12345,
    "gasUsed": "500000",
    "creator": "0xYourAddress",
    "tokenInfo": {
      "name": "TestToken",
      "symbol": "TEST",
      "decimals": 18,
      "totalSupply": "1000000"
    },
    "explorerUrl": "https://sepolia.arbiscan.io/address/0xFactory...",
    "transactionUrl": "https://sepolia.arbiscan.io/tx/0x..."
  }
}
```

### Get Token Info
```bash
curl http://localhost:3000/token/info/0
```

### Get Token Balance
```bash
curl http://localhost:3000/token/balance/0/0xYourAddress
```

### Transfer Tokens
```bash
curl -X POST http://localhost:3000/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "0xYourPrivateKey",
    "toAddress": "0xRecipientAddress",
    "amount": "100",
    "tokenId": "0"
  }'
```

---

## ✅ Test 3: AI-Powered Operations

### Test 3.1: Simple Token Deployment (Natural Language)

```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"tool": "deploy_erc20", "next_tool": null}
    ],
    "user_message": "Deploy a token called MyToken with symbol MTK and 1 million initial supply",
    "private_key": "0xYourPrivateKey"
  }'
```

**Expected Response:**
```json
{
  "agent_response": "I've successfully deployed your token MyToken (MTK) with 1 million initial supply. The token ID is 0 and has been confirmed on Arbitrum Sepolia. You can view the transaction at https://sepolia.arbiscan.io/tx/0x...",
  "tool_calls": [
    {
      "tool": "deploy_erc20",
      "parameters": {
        "privateKey": "0x...",
        "name": "MyToken",
        "symbol": "MTK",
        "initialSupply": "1000000"
      }
    }
  ],
  "results": [
    {
      "success": true,
      "tool": "deploy_erc20",
      "result": {
        "success": true,
        "data": {
          "tokenId": "0",
          "transactionHash": "0x..."
        }
      }
    }
  ]
}
```

### Test 3.2: Sequential Operations (Deploy → Transfer)

```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"tool": "deploy_erc20", "next_tool": "transfer"},
      {"tool": "transfer", "next_tool": null}
    ],
    "user_message": "Deploy a token called RewardToken (RWD, 1 million supply) and send 1000 tokens to 0xRecipientAddress",
    "private_key": "0xYourPrivateKey"
  }'
```

**What Happens:**
1. AI deploys the token
2. AI automatically gets the `tokenId`
3. AI automatically calls transfer with the `tokenId`
4. Returns complete summary

### Test 3.3: Get Balance (Natural Language)

```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"tool": "get_balance", "next_tool": null}
    ],
    "user_message": "What is the ETH balance of 0xYourAddress?",
    "private_key": null
  }'
```

### Test 3.4: Get Token Price

```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"tool": "fetch_price", "next_tool": null}
    ],
    "user_message": "What is the current price of Bitcoin and Ethereum?",
    "private_key": null
  }'
```

### Test 3.5: Deploy NFT Collection

```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"tool": "deploy_erc721", "next_tool": null}
    ],
    "user_message": "Deploy an NFT collection called MyNFTs with symbol MNFT and base URI ipfs://QmExample/",
    "private_key": "0xYourPrivateKey"
  }'
```

---

## ✅ Test 4: List Available Tools

```bash
curl http://localhost:8000/tools
```

**Expected Response:**
```json
{
  "tools": [
    "transfer",
    "get_balance",
    "deploy_erc20",
    "deploy_erc721",
    "fetch_price",
    "get_token_info",
    "get_token_balance",
    "mint_nft",
    "get_nft_info"
  ],
  "details": {
    "deploy_erc20": {
      "name": "deploy_erc20",
      "description": "Deploy a new ERC-20 token...",
      "endpoint": "http://localhost:3000/token/deploy",
      "method": "POST"
    },
    ...
  }
}
```

---

## 🐛 Troubleshooting

### Problem: "Connection refused" on port 3000
**Solution:** Start the blockchain backend first
```bash
cd backend && npm start
```

### Problem: "Connection refused" on port 8000
**Solution:** Start the AI agent backend
```bash
cd n8n_agent_backend && python main.py
```

### Problem: "GEMINI_API_KEY not found"
**Solution:** Add GEMINI_API_KEY to both .env files
```bash
# Get key from: https://makersuite.google.com/app/apikey
echo "GEMINI_API_KEY=your_key_here" >> backend/.env
echo "GEMINI_API_KEY=your_key_here" >> n8n_agent_backend/.env
```

### Problem: "TokenFactory contract address not configured"
**Solution:** Set contract addresses in backend/.env
```env
TOKEN_FACTORY_ADDRESS=0xYourDeployedAddress
NFT_FACTORY_ADDRESS=0xYourDeployedAddress
```

### Problem: "Insufficient balance for gas fees"
**Solution:** Fund your wallet with Arbitrum Sepolia ETH
- Faucet: https://faucet.quicknode.com/arbitrum/sepolia
- Or bridge from Sepolia: https://bridge.arbitrum.io/

### Problem: AI returns "I don't have access to that tool"
**Solution:** Check the tools array in your request
```json
{
  "tools": [
    {"tool": "deploy_erc20", "next_tool": null}  // Must match exact tool name
  ]
}
```

### Problem: "Tool execution failed"
**Check:**
1. Backend is running and healthy
2. Private key is valid (starts with 0x)
3. Wallet has sufficient balance
4. Contract addresses are configured
5. Check backend terminal for error logs

---

## 📊 Testing Checklist

- [ ] Both backends start without errors
- [ ] Health checks return 200 OK
- [ ] Direct token deployment works
- [ ] AI agent can deploy tokens
- [ ] Sequential operations work
- [ ] Token transfers work with tokenId
- [ ] Balance checks work
- [ ] NFT deployment works
- [ ] Price fetching works
- [ ] All tools listed in /tools endpoint

---

## 🎯 Next Steps After Testing

1. **Frontend Integration**: Use the AI agent endpoint in your frontend
   ```typescript
   POST http://localhost:8000/agent/chat
   ```

2. **Production Deployment**:
   - Deploy both backends to servers
   - Update BACKEND_URL in n8n_agent_backend
   - Update frontend API_URL to point to n8n_agent_backend

3. **Add More Tools**: Follow the pattern in `TOOL_DEFINITIONS` to add new capabilities

---

## 📝 Test Scenarios

### Scenario 1: Complete Token Lifecycle
```bash
# 1. Deploy
curl -X POST http://localhost:8000/agent/chat -H "Content-Type: application/json" \
  -d '{"tools": [{"tool": "deploy_erc20"}], "user_message": "Deploy MyToken (MTK, 1M)", "private_key": "0x..."}'

# 2. Get Info (use tokenId from step 1)
curl http://localhost:3000/token/info/0

# 3. Transfer
curl -X POST http://localhost:3000/transfer -H "Content-Type: application/json" \
  -d '{"privateKey": "0x...", "toAddress": "0xRecipient", "amount": "100", "tokenId": "0"}'

# 4. Check Balance
curl http://localhost:3000/token/balance/0/0xRecipient
```

### Scenario 2: NFT Collection with Minting
```bash
# 1. Deploy Collection
curl -X POST http://localhost:8000/agent/chat -H "Content-Type: application/json" \
  -d '{"tools": [{"tool": "deploy_erc721"}], "user_message": "Deploy NFT collection MyNFTs (MNFT) with base URI ipfs://Qm.../", "private_key": "0x..."}'

# 2. Mint NFT (use collectionAddress from step 1)
curl -X POST http://localhost:3000/nft/mint -H "Content-Type: application/json" \
  -d '{"privateKey": "0x...", "collectionAddress": "0xCollection", "toAddress": "0xRecipient"}'

# 3. Get NFT Info
curl http://localhost:3000/nft/info/0xCollection/0
```

---

**Happy Testing! 🎉**

For issues, check:
1. Terminal logs for both backends
2. Transaction on Arbiscan explorer
3. Ensure all environment variables are set

# Frontend Backend Integration Guide

## Overview

This document explains how the frontend integrates directly with the AI Agent Backend:
- **AI Agent Backend** (`n8n_agent_backend`) - Port 8000 - FastAPI + Google Gemini AI
- **Blockchain Backend** (`backend`) - Port 3000 - Express.js (called by AI backend, not frontend)

## Architecture Flow

```
User Browser (Next.js Frontend)
       ↓
AI Agent Backend (Port 8000) - Gemini AI orchestration
       ↓
Blockchain Backend (Port 3000) - Actual blockchain operations
       ↓
Arbitrum Sepolia Blockchain
```

**Note**: Frontend sends requests directly to port 8000, NOT through a Next.js API route.

## Setup Instructions

### 1. Environment Variables

Create a `.env.local` file in the `frontend` directory with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Privy Authentication
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# Blockchain Configuration
NEXT_PUBLIC_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
NEXT_PUBLIC_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_ETHERSCAN_API_KEY=your_etherscan_api_key

# Backend URLs
NEXT_PUBLIC_AI_AGENT_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BLOCKCHAIN_BACKEND_URL=http://localhost:3000
```

### 2. Start All Services

You need to start three services in separate terminals:

#### Terminal 1: Start Blockchain Backend
```bash
cd backend
npm install
npm start
# Runs on http://localhost:3000
```

#### Terminal 2: Start AI Agent Backend
```bash
cd n8n_agent_backend
pip install -r requirements.txt
python main.py
# Runs on http://localhost:8000
```

#### Terminal 3: Start Frontend
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000 (Next.js default) or 3001 if 3000 is taken
```

### 3. Verify All Services Are Running

```bash
# Check Blockchain Backend
curl http://localhost:3000/health

# Check AI Agent Backend
curl http://localhost:8000/health

# Check Frontend
curl http://localhost:3000  # or 3001
```

## Key Files and Their Roles

### Frontend Files

#### 1. `/frontend/lib/backend.ts`
**Purpose**: Backend service utility functions for direct API calls to port 8000.

**Key Functions**:
- `sendAgentChatMessage()` - Send chat message directly to AI agent backend (primary method)
- `checkAgentBackendHealth()` - Check if AI agent backend is running
- `checkBlockchainBackendHealth()` - Check if blockchain backend is running
- `listAvailableTools()` - Get list of all available blockchain tools

**Request Format** (matching TEST_REQUESTS.md):
```typescript
POST http://localhost:8000/agent/chat
{
  "tools": [
    { "tool": "deploy_erc20", "next_tool": null }
  ],
  "user_message": "Deploy a token called MyToken",
  "private_key": "0x..." // Optional: user's wallet private key
}
```

**Response Format**:
```typescript
{
  "response": "I've successfully deployed your token...",
  "tool_calls": [
    {
      "tool_name": "deploy_erc20",
      "tool_input": {
        "name": "MyToken",
        "symbol": "MTK",
        "initialSupply": "1000000"
      },
      "tool_result": {
        "success": true,
        "txHash": "0x...",
        "contractAddress": "0x...",
        "tokenId": "0x..."
      }
    }
  ]
}
```

**Usage Example**:
```typescript
import { sendAgentChatMessage } from '@/lib/backend';

// Get agent's tools configuration from database
const agent = await getAgentFromDatabase(agentId);

const response = await sendAgentChatMessage(
  agent.tools,  // Pass the tools array from agent config
  "Deploy a token called MyToken",
  userPrivateKey
);
```
import { sendAgentChatMessage } from '@/lib/backend'

#### 2. `/frontend/app/agent/[agentId]/chat/page.tsx`
**Purpose**: Chat interface for interacting with agents.

**Key Features**:
- Automatically retrieves user's private key from database if available
- Sends messages directly to AI Agent Backend on port 8000
- Displays AI responses and transaction results
- Removes private keys from displayed data for security

**Integration Points**:
```typescript
// Get user's private key from database
const { dbUser } = useAuth()
const privateKey = dbUser?.private_key || undefined

// Get agent's tools configuration
const agent = await getAgentById(agentId)

// Send message directly to AI backend
const data = await sendAgentChatMessage(
  agent.tools,  // Pass tools array
  userQuery,
  privateKey
)
```

#### 3. `/frontend/lib/wallet.ts`
**Purpose**: Wallet management utilities.

**Key Functions**:
- `createWallet()` - Generate a new wallet
- `saveWalletToUser()` - Save wallet to user's database record
- `getAddressFromPrivateKey()` - Derive address from private key
- `isValidPrivateKey()` - Validate private key format

#### 4. `/frontend/lib/agents.ts`
**Purpose**: Agent management utilities.

**Key Functions**:
- `createAgent()` - Create a new agent with tools
- `getAgentById()` - Retrieve agent by ID
- `getAgentByApiKey()` - Retrieve agent by API key (used in API route)
- `updateAgent()` - Update agent configuration
- `deleteAgent()` - Delete an agent

## Data Flow Example: Deploying a Token

### 1. User Action (Frontend)
```tsx
// User types in chat: "Deploy a token called MyToken with 1M supply"
// Get agent configuration with tools array
const agent = await getAgentById(agentId)

// Send directly to AI Agent Backend
const response = await sendAgentChatMessage(
  agent.tools,  // e.g., [{ tool: "deploy_erc20", next_tool: null }]
  "Deploy a token called MyToken with 1M supply",
  userPrivateKey
)
```

### 2. AI Agent Backend (Port 8000)
```python
# Receives request at /agent/chat
# Uses Google Gemini to understand intent
# Calls Blockchain Backend on port 3000
response = requests.post('http://localhost:3000/deploy-erc20', {
  "private_key": private_key,
  "name": "MyToken",
### 3. Blockchain Backend (`backend` - Port 3000)
```javascript
// Execute actual blockchain transaction
const tx = await tokenFactory.createToken(
  nameBytes32,
  symbolBytes32,
  decimals,
  initialSupply
)

// Return result to AI Agent Backend
return {
  success: true,
  tokenId: "0x...",
  transactionHash: tx.hash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed,
  contractAddress: "0x...",
  ...
}
```

### 4. Response Flow (Back to Frontend)
```
Blockchain Backend (port 3000) → AI Agent Backend (port 8000) → Frontend
```

The frontend displays:
- AI-generated response: "I've successfully deployed your token MyToken..."
- Transaction hash with explorer link
- Token ID and contract address

## Security Considerations

### Private Key Handling

1. **Storage**: Private keys are stored encrypted in Supabase database
2. **Transmission**: Private keys are sent via HTTPS in production
3. **Display**: Private keys are automatically removed from UI responses
4. **Access**: Only the API route has access to validate and use keys

### API Key Validation

1. All requests to `/api/agent/chat` must include a valid `api_key`
2. API keys are validated against the database before processing
3. Each agent has a unique API key generated on creation

## Testing the Integration

### 1. Health Checks
```bash
# Test all services are running
curl http://localhost:3000/health  # Blockchain backend
curl http://localhost:8000/health  # AI agent backend
```

### 2. Manual Testing Flow

1. **Create an Account**
   - Visit the frontend
   - Sign up with Google or wallet

2. **Create an Agent Wallet**
   - Go to "My Agents"
   - Click "Create Wallet" or "Import Wallet"
   - Save your private key securely

3. **Create an Agent**
   - Click "Create New Agent"
   - Add tools (e.g., deploy_erc20, transfer, get_balance)
   - Save the agent

4. **Test Agent Chat**
   - Click on your agent
   - Try commands like:
     - "What's the current price of Bitcoin?"
     - "Get my ETH balance"
     - "Deploy a token called TestToken with 1000 supply"

### 3. Verify Integration

Check that:
- ✅ AI agent backend receives the request
- ✅ Blockchain backend executes the transaction
- ✅ Transaction appears on Arbitrum Sepolia explorer
- ✅ Response is displayed correctly in the chat

## Troubleshooting

### Common Issues

#### 1. "Cannot connect to AI agent backend"
**Solution**: Ensure `n8n_agent_backend` is running on port 8000
```bash
cd n8n_agent_backend
python main.py
```

#### 2. "Blockchain backend not responding"
**Solution**: Ensure `backend` is running on port 3000
```bash
cd backend
npm start
```

#### 3. "Agent tools not configured"
**Solution**: Verify the agent has tools array configured in the database:
```sql
-- Check agent configuration
SELECT id, name, tools FROM agents WHERE id = 'your-agent-id';
```

#### 4. "Transaction failed"
**Solution**: 
- Check wallet has enough ETH for gas
- Verify contract addresses in `backend/.env`
- Check RPC connection

#### 5. "CORS errors in browser"
**Solution**: Ensure AI Agent Backend allows requests from your frontend origin (check main.py CORS settings)

### Debug Mode

Enable debug logging by checking console outputs:

**Frontend (Browser Console)**:
```javascript
// Shows API requests and responses
console.log('Sending message to agent...')
```

**AI Agent Backend**:
```bash
# Shows Gemini AI processing
INFO:     "POST /agent/chat HTTP/1.1" 200 OK
```

**Blockchain Backend**:
```bash
# Shows blockchain transactions
Token deployed successfully: { tokenId: '0x...', txHash: '0x...' }
```

## Available Tools

The following tools are available in the AI agent backend:

| Tool | Description | Required Parameters |
|------|-------------|-------------------|
| `deploy_erc20` | Deploy ERC20 token | privateKey, name, symbol, initialSupply |
| `deploy_erc721` | Deploy NFT collection | privateKey, name, symbol, baseURI |
| `transfer` | Transfer ETH or tokens | privateKey, toAddress, amount, [tokenId] |
| `get_balance` | Get ETH balance | address |
| `get_token_balance` | Get token balance | tokenId, ownerAddress |
| `get_token_info` | Get token information | tokenId |
| `mint_nft` | Mint NFT in collection | privateKey, collectionAddress, toAddress |
| `get_nft_info` | Get NFT information | collectionAddress, tokenId |
| `fetch_price` | Get crypto price | query |

## Production Deployment

### Environment Variables (Production)

Update these for production:
```env
NEXT_PUBLIC_AI_AGENT_BACKEND_URL=https://your-ai-backend.com
NEXT_PUBLIC_BLOCKCHAIN_BACKEND_URL=https://your-blockchain-backend.com
```

### CORS Configuration

Ensure backend services allow requests from your frontend domain:

**AI Agent Backend** (`n8n_agent_backend/main.py`):
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Blockchain Backend** (`backend/server.js`):
```javascript
app.use(cors({
  origin: 'https://your-frontend.com'
}))
```

## Support

For issues or questions:
1. Check this documentation
2. Review the TEST_REQUESTS.md file for example requests
3. Check backend logs for detailed error messages
4. Verify all services are running with health checks

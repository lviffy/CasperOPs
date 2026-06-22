# Backend API Documentation

## Table of Contents
1. [Getting Started](#getting-started)
2. [Testing the Backend](#testing-the-backend)
3. [API Endpoints](#api-endpoints)
   - [Health Check](#health-check)
   - [Token Operations](#token-operations)
   - [NFT Operations](#nft-operations)
   - [Transfer Operations](#transfer-operations)
   - [Price Fetching](#price-fetching)
   - [Natural Language Executor](#natural-language-executor)
4. [Frontend Integration Guide](#frontend-integration-guide)

---

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Arbitrum Sepolia testnet access
- Deployed Stylus contracts (TokenFactory & NFTFactory)

### Installation

```bash
cd backend
npm install
```

### Environment Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Configure your `.env` file:
```env
PORT=3000

# REQUIRED: Stylus Contract Addresses
TOKEN_FACTORY_ADDRESS=0xYourTokenFactoryAddress
NFT_FACTORY_ADDRESS=0xYourNFTFactoryAddress

# OPTIONAL: AI Features
GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

### Start the Server

```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev
```

The server will start on `http://localhost:3000`

---

## Testing the Backend

### Method 1: Using cURL

#### Test Health Check
```bash
curl http://localhost:3000/health
```

#### Test Token Deployment
```bash
curl -X POST http://localhost:3000/token/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "0xYourPrivateKey",
    "name": "MyToken",
    "symbol": "MTK",
    "initialSupply": "1000000",
    "decimals": 18
  }'
```

#### Test Token Info
```bash
curl http://localhost:3000/token/info/0
```

#### Test Token Balance
```bash
curl http://localhost:3000/token/balance/0/0xYourWalletAddress
```

### Method 2: Using Postman

1. Import the collection from the examples below
2. Set up environment variables for `BASE_URL` = `http://localhost:3000`
3. Test each endpoint individually

### Method 3: Using the Test Script

```bash
npm test
```

This will run `test.js` which contains basic endpoint tests.

### Method 4: Using Thunder Client (VS Code Extension)

1. Install Thunder Client extension
2. Create a new request
3. Use the endpoint details from the API documentation below

---

## API Endpoints

### Base URL
```
http://localhost:3000
```

---

## Health Check

### GET /health

Check if the server is running and configured correctly.

**Request:**
```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-11-23T10:30:00.000Z",
    "network": "Arbitrum Sepolia",
    "rpc": "https://sepolia-rollup.arbitrum.io/rpc",
    "contracts": {
      "tokenFactory": "0xYourTokenFactoryAddress",
      "nftFactory": "0xYourNFTFactoryAddress"
    }
  }
}
```

---

## Token Operations

### POST /token/deploy

Deploy a new ERC20 token via the Stylus TokenFactory.

**Request:**
```http
POST /token/deploy
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "name": "MyToken",
  "symbol": "MTK",
  "initialSupply": "1000000",
  "decimals": 18
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key (with 0x prefix) |
| name | string | Yes | Token name (e.g., "Bitcoin") |
| symbol | string | Yes | Token symbol (e.g., "BTC") |
| initialSupply | string/number | Yes | Initial token supply (will be multiplied by 10^decimals) |
| decimals | number | No | Token decimals (default: 18) |

**Response:**
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
    "estimatedCost": "0.001",
    "creator": "0xYourWalletAddress",
    "tokenInfo": {
      "name": "MyToken",
      "symbol": "MTK",
      "decimals": 18,
      "totalSupply": "1000000",
      "creator": "0xYourWalletAddress"
    },
    "explorerUrl": "https://sepolia.arbiscan.io/address/0xFactoryAddress",
    "transactionUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

---

### GET /token/info/:tokenId

Get information about a deployed token.

**Request:**
```http
GET /token/info/0
```

**URL Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| tokenId | number | The token ID returned from deployment |

**Response:**
```json
{
  "success": true,
  "data": {
    "tokenId": "0",
    "factoryAddress": "0xFactoryAddress",
    "name": "MyToken",
    "symbol": "MTK",
    "decimals": 18,
    "totalSupply": "1000000.0",
    "totalSupplyRaw": "1000000000000000000000000",
    "creator": "0xCreatorAddress",
    "network": "Arbitrum Sepolia"
  }
}
```

---

### GET /token/balance/:tokenId/:ownerAddress

Get token balance for a specific address.

**Request:**
```http
GET /token/balance/0/0xOwnerAddress
```

**URL Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| tokenId | number | The token ID |
| ownerAddress | string | Wallet address to check balance |

**Response:**
```json
{
  "success": true,
  "data": {
    "tokenId": "0",
    "factoryAddress": "0xFactoryAddress",
    "ownerAddress": "0xOwnerAddress",
    "balance": "1000000.0",
    "balanceRaw": "1000000000000000000000000",
    "decimals": 18,
    "network": "Arbitrum Sepolia"
  }
}
```

---

## NFT Operations

### POST /nft/deploy-collection

Deploy a new ERC721 NFT collection via the Stylus NFTFactory.

**Request:**
```http
POST /nft/deploy-collection
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "name": "MyNFTCollection",
  "symbol": "MNFT",
  "baseURI": "ipfs://QmYourBaseURI/"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key |
| name | string | Yes | Collection name |
| symbol | string | Yes | Collection symbol |
| baseURI | string | Yes | Base URI for token metadata |

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "NFT Collection deployed successfully via Stylus NFTFactory",
    "collectionAddress": "0xCollectionAddress",
    "transactionHash": "0xTransactionHash",
    "blockNumber": 12345,
    "gasUsed": "600000",
    "estimatedCost": "0.002",
    "creator": "0xYourWalletAddress",
    "collectionInfo": {
      "name": "MyNFTCollection",
      "symbol": "MNFT",
      "baseURI": "ipfs://QmYourBaseURI/"
    },
    "explorerUrl": "https://sepolia.arbiscan.io/address/0xCollectionAddress",
    "transactionUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

---

### POST /nft/mint

Mint a new NFT in an existing collection.

**Request:**
```http
POST /nft/mint
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "collectionAddress": "0xCollectionAddress",
  "toAddress": "0xRecipientAddress"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key (must be collection creator) |
| collectionAddress | string | Yes | NFT collection contract address |
| toAddress | string | Yes | Recipient wallet address |

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "NFT minted successfully",
    "collectionAddress": "0xCollectionAddress",
    "tokenId": "1",
    "recipient": "0xRecipientAddress",
    "transactionHash": "0xTransactionHash",
    "blockNumber": 12346,
    "gasUsed": "150000",
    "tokenURI": "ipfs://QmYourBaseURI/1",
    "explorerUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

---

### GET /nft/info/:collectionAddress/:tokenId

Get information about a specific NFT.

**Request:**
```http
GET /nft/info/0xCollectionAddress/1
```

**URL Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| collectionAddress | string | NFT collection address |
| tokenId | number | Token ID within the collection |

**Response:**
```json
{
  "success": true,
  "data": {
    "collectionAddress": "0xCollectionAddress",
    "tokenId": "1",
    "owner": "0xOwnerAddress",
    "tokenURI": "ipfs://QmYourBaseURI/1",
    "collectionInfo": {
      "name": "MyNFTCollection",
      "symbol": "MNFT",
      "totalSupply": "5"
    },
    "network": "Arbitrum Sepolia"
  }
}
```

---

## Transfer Operations

### POST /transfer

Transfer native ETH or ERC20 tokens.

**Request (Native ETH):**
```http
POST /transfer
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "toAddress": "0xRecipientAddress",
  "amount": "0.1"
}
```

**Request (ERC20 Token):**
```http
POST /transfer
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "toAddress": "0xRecipientAddress",
  "amount": "100",
  "tokenId": "0"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key |
| toAddress | string | Yes | Recipient address |
| amount | string/number | Yes | Amount to transfer |
| tokenId | number | No | Token ID (omit for native ETH) |

**Response (Native ETH):**
```json
{
  "success": true,
  "data": {
    "type": "native",
    "transactionHash": "0xTransactionHash",
    "from": "0xYourAddress",
    "to": "0xRecipientAddress",
    "amount": "0.1",
    "blockNumber": 12347,
    "gasUsed": "21000",
    "explorerUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

**Response (ERC20 Token):**
```json
{
  "success": true,
  "data": {
    "type": "erc20",
    "transactionHash": "0xTransactionHash",
    "from": "0xYourAddress",
    "to": "0xRecipientAddress",
    "amount": "100",
    "tokenId": "0",
    "factoryAddress": "0xFactoryAddress",
    "tokenName": "MyToken",
    "tokenSymbol": "MTK",
    "blockNumber": 12348,
    "gasUsed": "65000",
    "explorerUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

---

### GET /transfer/balance/:address

Get native ETH balance for an address.

**Request:**
```http
GET /transfer/balance/0xYourAddress
```

**URL Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| address | string | Wallet address |

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0xYourAddress",
    "balance": "1.5",
    "balanceWei": "1500000000000000000",
    "network": "Arbitrum Sepolia"
  }
}
```

---

## Price Fetching

### POST /price/token

Fetch current cryptocurrency prices using natural language queries.

**Request:**
```http
POST /price/token
Content-Type: application/json

{
  "query": "bitcoin and ethereum prices"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | Yes | Natural language query (e.g., "bitcoin price", "BTC ETH SOL prices") |

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "bitcoin and ethereum prices",
    "result": "Bitcoin (BTC): $45,230.50 USD (+2.3% in 24h)\nEthereum (ETH): $2,845.75 USD (+1.8% in 24h)\nSource: CoinGecko",
    "timestamp": "2025-11-23T10:30:00.000Z",
    "model": "gemini-2.0-flash-exp"
  }
}
```

**Note:** Requires `GEMINI_API_KEY` to be configured in `.env`

---

## Natural Language Executor

### GET /nl-executor/discover/:contractAddress

Discover contract functions and generate a description.

**Request:**
```http
GET /nl-executor/discover/0xContractAddress
```

**URL Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| contractAddress | string | Contract address to discover |

**Response:**
```json
{
  "success": true,
  "data": {
    "contractAddress": "0xContractAddress",
    "functions": [
      {
        "name": "transfer",
        "type": "function",
        "inputs": [
          {"name": "to", "type": "address"},
          {"name": "amount", "type": "uint256"}
        ],
        "outputs": [{"type": "bool"}],
        "stateMutability": "nonpayable"
      }
    ],
    "description": "This contract is an ERC20 token with standard transfer, approve, and allowance functions..."
  }
}
```

**Note:** Requires `ETHERSCAN_API_KEY` to be configured.

---

### POST /nl-executor/execute

Execute a contract function using natural language.

**Request:**
```http
POST /nl-executor/execute
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "contractAddress": "0xContractAddress",
  "naturalLanguageQuery": "transfer 100 tokens to 0xRecipientAddress"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key |
| contractAddress | string | Yes | Target contract address |
| naturalLanguageQuery | string | Yes | Natural language instruction |

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Contract function executed successfully",
    "contractAddress": "0xContractAddress",
    "functionCalled": "transfer",
    "parameters": ["0xRecipientAddress", "100000000000000000000"],
    "transactionHash": "0xTransactionHash",
    "blockNumber": 12349,
    "gasUsed": "65000",
    "explorerUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

**Note:** Requires `ETHERSCAN_API_KEY` and `GEMINI_API_KEY`/`OPENAI_API_KEY`.

---

### POST /nl-executor/quick-execute

Directly execute a contract function (bypassing NL processing).

**Request:**
```http
POST /nl-executor/quick-execute
Content-Type: application/json

{
  "privateKey": "0xYourPrivateKey",
  "contractAddress": "0xContractAddress",
  "functionName": "transfer",
  "parameters": ["0xRecipientAddress", "100000000000000000000"]
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| privateKey | string | Yes | Wallet private key |
| contractAddress | string | Yes | Target contract address |
| functionName | string | Yes | Exact function name |
| parameters | array | Yes | Function parameters in correct order |

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Contract function executed successfully",
    "contractAddress": "0xContractAddress",
    "functionCalled": "transfer",
    "parameters": ["0xRecipientAddress", "100000000000000000000"],
    "transactionHash": "0xTransactionHash",
    "blockNumber": 12350,
    "gasUsed": "65000",
    "explorerUrl": "https://sepolia.arbiscan.io/tx/0xTransactionHash"
  }
}
```

---

## Frontend Integration Guide

### Installation

```bash
npm install axios
# or
yarn add axios
```

### API Client Setup

Create an API client file (e.g., `lib/api.ts` or `lib/api.js`):

```typescript
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const errorMessage = error.response?.data?.error || error.message;
    console.error('API Error:', errorMessage);
    throw new Error(errorMessage);
  }
);

export default apiClient;
```

### Example Usage in Frontend

#### 1. Deploy Token

```typescript
import apiClient from '@/lib/api';

async function deployToken(
  privateKey: string,
  name: string,
  symbol: string,
  initialSupply: string,
  decimals: number = 18
) {
  try {
    const response = await apiClient.post('/token/deploy', {
      privateKey,
      name,
      symbol,
      initialSupply,
      decimals,
    });
    
    return response.data;
  } catch (error) {
    console.error('Deploy token failed:', error);
    throw error;
  }
}

// Usage in component
const handleDeploy = async () => {
  const result = await deployToken(
    wallet.privateKey,
    'MyToken',
    'MTK',
    '1000000',
    18
  );
  
  console.log('Token deployed:', result.tokenId);
  console.log('Transaction:', result.transactionUrl);
};
```

#### 2. Get Token Info

```typescript
async function getTokenInfo(tokenId: number) {
  try {
    const response = await apiClient.get(`/token/info/${tokenId}`);
    return response.data;
  } catch (error) {
    console.error('Get token info failed:', error);
    throw error;
  }
}
```

#### 3. Transfer Tokens

```typescript
async function transferTokens(
  privateKey: string,
  toAddress: string,
  amount: string,
  tokenId?: number
) {
  try {
    const response = await apiClient.post('/transfer', {
      privateKey,
      toAddress,
      amount,
      ...(tokenId !== undefined && { tokenId }),
    });
    
    return response.data;
  } catch (error) {
    console.error('Transfer failed:', error);
    throw error;
  }
}
```

#### 4. Deploy NFT Collection

```typescript
async function deployNFTCollection(
  privateKey: string,
  name: string,
  symbol: string,
  baseURI: string
) {
  try {
    const response = await apiClient.post('/nft/deploy-collection', {
      privateKey,
      name,
      symbol,
      baseURI,
    });
    
    return response.data;
  } catch (error) {
    console.error('Deploy NFT collection failed:', error);
    throw error;
  }
}
```

#### 5. Fetch Token Prices

```typescript
async function getTokenPrice(query: string) {
  try {
    const response = await apiClient.post('/price/token', { query });
    return response.data;
  } catch (error) {
    console.error('Get token price failed:', error);
    throw error;
  }
}

// Usage
const prices = await getTokenPrice('bitcoin ethereum solana prices');
```

### React Hook Example

```typescript
import { useState } from 'react';
import apiClient from '@/lib/api';

export function useTokenDeployment() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const deployToken = async (
    privateKey: string,
    name: string,
    symbol: string,
    initialSupply: string,
    decimals: number = 18
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.post('/token/deploy', {
        privateKey,
        name,
        symbol,
        initialSupply,
        decimals,
      });
      
      setResult(response.data);
      return response.data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { deployToken, loading, error, result };
}
```

### Error Handling

All API responses follow this format:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details (optional)"
}
```

### Environment Variables for Frontend

Create a `.env.local` file in your frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

For production:
```env
NEXT_PUBLIC_API_URL=https://your-backend-api.com
```

---

## Common Issues & Troubleshooting

### 1. Contract Address Not Configured
**Error:** `TokenFactory contract address not configured`

**Solution:** Set `TOKEN_FACTORY_ADDRESS` and `NFT_FACTORY_ADDRESS` in `.env`

### 2. Insufficient Balance
**Error:** `Insufficient balance for gas fees`

**Solution:** Fund your wallet with Arbitrum Sepolia ETH from a faucet

### 3. Private Key Format
**Error:** `Invalid private key`

**Solution:** Ensure private key starts with `0x` prefix

### 4. Gas Estimation Failed
**Warning:** May proceed without gas estimation

**Note:** Transaction will still be attempted with default gas limits

### 5. API Keys Not Configured
**Error:** `GEMINI_API_KEY not configured`

**Solution:** Add the required API key to `.env` file

---

## Rate Limits & Best Practices

1. **RPC Rate Limits:** Arbitrum Sepolia public RPC has rate limits. Consider using a dedicated RPC provider for production.

2. **Private Key Security:** Never commit private keys to version control. Use environment variables.

3. **Error Handling:** Always wrap API calls in try-catch blocks.

4. **Gas Estimation:** The API automatically estimates gas and adds a 20% buffer.

5. **Transaction Confirmation:** All transaction endpoints wait for confirmation before returning.

---

## Support

For issues or questions:
- Check the logs in the terminal where the server is running
- Review the transaction on Arbiscan using the provided `explorerUrl`
- Ensure all environment variables are correctly configured

---

**Last Updated:** November 23, 2025  
**API Version:** 1.0.0  
**Network:** Arbitrum Sepolia Testnet

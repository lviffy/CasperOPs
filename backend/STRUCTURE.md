# Backend File Structure Documentation

## Overview

The backend has been refactored into a clean, modular architecture following MVC (Model-View-Controller) pattern with separation of concerns.

## Directory Structure

```
backend/
├── app.js                      # Express app configuration
├── server.js                   # Server entry point
├── package.json                # Dependencies and scripts
├── .env                        # Environment variables (gitignored)
├── .env.example                # Environment template
│
├── config/                     # Configuration files
│   ├── constants.js            # App constants and env variables
│   └── abis.js                 # Smart contract ABIs
│
├── controllers/                # Business logic
│   ├── tokenController.js      # Token operations logic
│   ├── nftController.js        # NFT operations logic
│   ├── transferController.js   # Transfer operations logic
│   └── priceController.js      # AI-powered token price fetching
│
├── routes/                     # API route definitions
│   ├── tokenRoutes.js          # Token endpoints
│   ├── nftRoutes.js            # NFT endpoints
│   ├── transferRoutes.js       # Transfer endpoints
│   ├── healthRoutes.js         # Health check endpoint
│   └── priceRoutes.js          # Token price endpoints
│
├── utils/                      # Utility functions
│   ├── blockchain.js           # Blockchain helper functions
│   └── helpers.js              # General helper functions
│
├── test.js                     # Test suite
└── main_old.js                 # Original monolithic file (backup)
```

## File Descriptions

### Entry Points

#### `server.js`
- Main entry point of the application
- Imports and starts the Express app
- Minimal file that requires `app.js`

#### `app.js`
- Express application configuration
- Middleware setup
- Route mounting
- Error handling
- Server startup logic

### Configuration (`config/`)

#### `constants.js`
- Environment variables
- Network configuration
- Contract addresses
- API keys
- Port configuration

#### `abis.js`
- TokenFactory ABI
- NFTFactory ABI
- ERC20 Token ABI
- ERC721 Collection ABI

### Controllers (`controllers/`)

#### `tokenController.js`
**Functions:**
- `deployToken(req, res)` - Deploy ERC20 token via factory
- `getTokenInfo(req, res)` - Get token metadata
- `getTokenBalance(req, res)` - Get token balance for address

#### `nftController.js`
**Functions:**
- `deployNFTCollection(req, res)` - Deploy NFT collection via factory
- `mintNFT(req, res)` - Mint NFT from collection
- `getNFTInfo(req, res)` - Get NFT metadata

#### `transferController.js`
**Functions:**
- `transfer(req, res)` - Transfer ETH or ERC20 tokens
- `transferERC20(res, wallet, ...)` - Internal ERC20 transfer logic
- `transferNative(res, wallet, ...)` - Internal native ETH transfer logic
- `getBalance(req, res)` - Get native ETH balance

#### `priceController.js`
**Functions:**
- `getTokenPrice(req, res)` - Get token prices using natural language queries via Google Gemini AI
  - Uses Gemini 2.0 Flash with Google Search grounding for real-time web data
  - Supports queries like "bitcoin price", "show me ethereum and solana prices"
  - Returns formatted price information with sources

### Routes (`routes/`)

#### `tokenRoutes.js`
```
POST   /token/deploy
GET    /token/info/:tokenAddress
GET    /token/balance/:tokenAddress/:ownerAddress
```

#### `priceRoutes.js`
```
POST   /price/token
```

#### `nftRoutes.js`
```
POST   /nft/deploy-collection
POST   /nft/mint
GET    /nft/info/:collectionAddress/:tokenId
```

#### `transferRoutes.js`
```
POST   /transfer
GET    /transfer/balance/:address
```

#### `healthRoutes.js`
```
GET    /health
```

### Utilities (`utils/`)

#### `blockchain.js`
**Functions:**
- `getProvider()` - Get Arbitrum Sepolia provider
- `getWallet(privateKey, provider)` - Create wallet instance
- `getContract(address, abi, signer)` - Create contract instance
- `hasSufficientBalance(address, amount)` - Check wallet balance
- `getGasEstimateWithBuffer(method, args, buffer)` - Estimate gas with buffer
- `parseEventFromReceipt(receipt, interface, eventName)` - Parse events from receipt

#### `helpers.js`
**Functions:**
- `getTxExplorerUrl(txHash)` - Generate transaction explorer URL
- `getAddressExplorerUrl(address)` - Generate address explorer URL
- `successResponse(data)` - Format success response
- `errorResponse(error, details)` - Format error response
- `validateRequiredFields(body, fields)` - Validate request body
- `logTransaction(action, details)` - Log transaction details

## Benefits of New Structure

### 1. **Separation of Concerns**
- Business logic separated from routes
- Configuration separated from code
- Utilities are reusable across controllers

### 2. **Maintainability**
- Easy to locate and modify specific features
- Clear responsibility for each file
- Reduced code duplication

### 3. **Scalability**
- Easy to add new endpoints
- Simple to add new features
- Can split large files further if needed

### 4. **Testability**
- Controllers can be unit tested independently
- Utilities can be tested in isolation
- Routes can be integration tested

### 5. **Readability**
- Each file has a single, clear purpose
- Function names are descriptive
- Code is organized logically

### 6. **Collaboration**
- Multiple developers can work on different files
- Reduced merge conflicts
- Easier code reviews

## API Endpoints

### New RESTful Routes
```
# Health
GET    /health

# Tokens
POST   /token/deploy
GET    /token/info/:tokenAddress
GET    /token/balance/:tokenAddress/:ownerAddress

# NFTs
POST   /nft/deploy-collection
POST   /nft/mint
GET    /nft/info/:collectionAddress/:tokenId

# Transfers
POST   /transfer
GET    /transfer/balance/:address
```

### Legacy Routes (Backwards Compatibility)
```
POST   /deploy-token
POST   /deploy-nft-collection
POST   /mint-nft
GET    /balance/:address
GET    /token-info/:tokenAddress
GET    /token-balance/:tokenAddress/:ownerAddress
GET    /nft-info/:collectionAddress/:tokenId
```

## Usage Examples

### Starting the Server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev

# Run tests
npm test
```

### Making API Calls

#### Deploy Token (New Route)
```bash
curl -X POST http://localhost:3000/token/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "0x...",
    "name": "My Token",
    "symbol": "MTK",
    "initialSupply": "1000000",
    "decimals": 18
  }'
```

#### Get Token Info
```bash
curl http://localhost:3000/token/info/0xTokenAddress
```

#### Get Token Price (AI-Powered)
```bash
curl -X POST http://localhost:3000/price/token \
  -H "Content-Type: application/json" \
  -d '{
    "query": "bitcoin price"
  }'

# More examples:
# "show me ethereum and solana prices"
# "what is dogecoin worth"
# "prices for BTC, ETH, and BNB"
```

#### Deploy NFT Collection
```bash
curl -X POST http://localhost:3000/nft/deploy-collection \
  -H "Content-Type: application/json" \
  -d '{
    "privateKey": "0x...",
    "name": "My NFTs",
    "symbol": "MNFT",
    "baseURI": "ipfs://..."
  }'
```

## Migration from Old Structure

The old monolithic `main.js` has been preserved as `main_old.js` for reference. All functionality has been migrated to the new structure with the following improvements:

1. **No Breaking Changes**: Legacy routes still work
2. **Better Organization**: Code is now modular
3. **Enhanced Logging**: Better transaction logging
4. **Error Handling**: Improved error responses
5. **Code Reuse**: Common functions extracted to utilities

## Environment Variables

Required in `.env` file:

```env
# Server
PORT=3000

# Contracts
TOKEN_FACTORY_ADDRESS=0x...
NFT_FACTORY_ADDRESS=0x...

# Optional
OPENAI_API_KEY=
GEMINI_API_KEY=your_gemini_api_key_here
PINATA_API_KEY=
PINATA_SECRET_KEY=
```

## Feature: AI-Powered Token Price Fetching

The backend includes an AI-powered token price endpoint using **Google Gemini 2.0 Flash** with Google Search grounding. This provides real-time cryptocurrency price data through natural language queries.

### Features:
- 🤖 Natural language query support (e.g., "bitcoin price", "show me ethereum and solana")
- 🌐 Real-time web search via Google Search grounding
- 📊 Accurate price data from reliable sources (CoinMarketCap, CoinGecko, Binance)
- 🔗 Source attribution with URLs
- 💡 Understands various query formats

### Setup:
1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Add to your `.env` file:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Usage Example:
```bash
curl -X POST http://localhost:3000/price/token \
  -H "Content-Type: application/json" \
  -d '{"query": "bitcoin and ethereum prices"}'
```

### Response:
```json
{
  "success": true,
  "query": "bitcoin and ethereum prices",
  "priceInfo": "Bitcoin (BTC): $45,234.56 USD (+2.3% 24h)\nEthereum (ETH): $2,987.12 USD (+1.8% 24h)",
  "sources": [
    {
      "title": "Bitcoin Price - CoinMarketCap",
      "url": "https://coinmarketcap.com/currencies/bitcoin/"
    }
  ],
  "model": "gemini-2.0-flash-exp"
}
```

## Best Practices

1. **Adding New Features**:
   - Create controller function
   - Add route definition
   - Update documentation

2. **Error Handling**:
   - Use `errorResponse()` helper
   - Always provide meaningful error messages
   - Log errors for debugging

3. **Validation**:
   - Use `validateRequiredFields()` helper
   - Validate input types
   - Check contract addresses

4. **Logging**:
   - Use `logTransaction()` for operations
   - Log transaction hashes
   - Log errors with context

## Testing

```bash
# Run basic health checks
npm test

# Or manually test endpoints
curl http://localhost:3000/health
```

## Future Enhancements

Potential improvements:
- Add middleware for authentication
- Implement rate limiting
- Add request validation middleware
- Create service layer for complex business logic
- Add database integration for caching
- Implement WebSocket support for real-time updates

---

**Last Updated**: November 22, 2025
**Structure Version**: 2.0

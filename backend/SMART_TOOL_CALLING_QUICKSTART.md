# Smart Tool Calling - Quick Start

## What Changed?

The conversation controller now uses **AI-powered intelligent routing** instead of simple regex pattern matching.

### Before (Regex-Based)
```javascript
if (/price/i.test(message)) tools.push('fetch_price');
if (/balance/i.test(message)) tools.push('get_balance');
// Both run in parallel, no coordination!
```

### After (AI-Powered)
```javascript
const plan = await intelligentToolRouting(message);
// AI understands: "get balance → fetch price → calculate"
// Tools run in correct sequential order!
```

## Example

**User Query:**
> "Tell me how much Solana I can buy with the balance of wallet 0xdA45...2B97 and tell me the current price of Solana"

**Old System (Regex):**
- ❌ Runs `fetch_price` and `get_balance` in parallel
- ❌ Doesn't calculate the answer
- ❌ Incomplete response

**New System (AI):**
- ✅ Step 1: Get wallet balance
- ✅ Step 2: Get Solana price
- ✅ Step 3: Calculate how much Solana can be bought
- ✅ Complete, accurate answer!

## Files Changed

1. **New:** `backend/services/toolRouter.js` - Intelligent routing service
2. **Updated:** `backend/controllers/conversationController.js` - Uses intelligent routing
3. **Docs:** `SMART_TOOL_CALLING.md` - Complete documentation

## Testing

Run the test suite:
```bash
cd backend
node test_smart_routing.js
```

Test manually via API:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test",
    "agentId": "test",
    "message": "Tell me BTC price and how much I can buy with 1 ETH"
  }'
```

## How It Works

1. **User sends message** → `conversationController.chat()`
2. **AI analyzes message** → `intelligentToolRouting()`
3. **Creates execution plan** → Sequential or parallel tools
4. **Extracts parameters** → From natural language
5. **Checks for missing info** → Asks user if needed
6. **Executes tools** → In correct order via agent backend
7. **Returns response** → With complete answer

## Configuration

Required environment variables:
```bash
GROQ_API_KEY=your_groq_key        # Primary AI
GEMINI_API_KEY=your_gemini_key    # Fallback AI
```

## Adding New Tools

Edit `backend/services/toolRouter.js`:

```javascript
const AVAILABLE_TOOLS = {
  my_new_tool: {
    name: 'my_new_tool',
    description: 'What your tool does',
    parameters: ['param1', 'param2'],
    examples: ['Example query 1', 'Example query 2']
  }
};
```

The AI will automatically learn to use it!

## Benefits

- ✅ Handles complex multi-step requests
- ✅ Determines correct execution order
- ✅ Extracts parameters from natural language
- ✅ Asks for missing information
- ✅ More natural conversation
- ✅ Self-improving with better AI models

## Debug Logging

Enable in `conversationController.js`:
```javascript
console.log('[Tool Router] Plan:', JSON.stringify(routingPlan, null, 2));
```

## Need Help?

- Read full docs: `SMART_TOOL_CALLING.md`
- Run tests: `node test_smart_routing.js`
- Check logs: Look for `[Chat]` and `[Tool Router]` prefixes

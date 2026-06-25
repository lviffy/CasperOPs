# Conversation Memory API Documentation

## Overview

This API provides conversation memory capabilities with automatic message cleanup, token management, and AI-powered responses using Groq.

**Base URL**: `http://localhost:3000/api`

---

## Authentication

Most endpoints don't require authentication (uses `userId` for access control).

Admin endpoints require:
```
Authorization: Bearer <ADMIN_SECRET>
```

---

## Endpoints

### 1. Chat with AI

Send a message and get an AI response. Automatically manages conversation history.

**Endpoint**: `POST /api/chat`

**Request Body**:
```json
{
  "agentId": "agent-123",
  "userId": "user-456",
  "message": "What is blockchain?",
  "conversationId": "optional-existing-conversation-id",
  "systemPrompt": "Optional custom system prompt"
}
```

**Response**:
```json
{
  "conversationId": "uuid-here",
  "message": "AI response here",
  "isNewConversation": true,
  "messageCount": 2,
  "tokenCount": 150
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "blockchain-agent",
    "userId": "user-123",
    "message": "Explain smart contracts in simple terms"
  }'
```

---

### 2. List Conversations

Get all conversations for a user.

**Endpoint**: `GET /api/conversations`

**Query Parameters**:
- `userId` (required): User ID
- `agentId` (optional): Filter by agent
- `limit` (optional, default: 20): Max results

**Response**:
```json
{
  "conversations": [
    {
      "id": "uuid",
      "agent_id": "agent-123",
      "title": "What is blockchain?",
      "message_count": 5,
      "created_at": "2026-02-05T10:00:00Z",
      "updated_at": "2026-02-05T10:15:00Z"
    }
  ],
  "count": 1
}
```

**Example**:
```bash
curl "http://localhost:3000/api/conversations?userId=user-123&limit=10"
```

---

### 3. Get Conversation

Get details of a specific conversation.

**Endpoint**: `GET /api/conversations/:conversationId`

**Response**:
```json
{
  "conversation": {
    "id": "uuid",
    "agent_id": "agent-123",
    "user_id": "user-456",
    "title": "What is blockchain?",
    "message_count": 5,
    "created_at": "2026-02-05T10:00:00Z",
    "updated_at": "2026-02-05T10:15:00Z"
  }
}
```

**Example**:
```bash
curl "http://localhost:3000/api/conversations/uuid-here"
```

---

### 4. Get Messages

Get all messages in a conversation.

**Endpoint**: `GET /api/conversations/:conversationId/messages`

**Query Parameters**:
- `limit` (optional, default: 50): Max messages

**Response**:
```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "What is blockchain?",
      "tool_calls": null,
      "created_at": "2026-02-05T10:00:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "Blockchain is a distributed ledger...",
      "tool_calls": null,
      "created_at": "2026-02-05T10:00:05Z"
    }
  ],
  "count": 2
}
```

**Example**:
```bash
curl "http://localhost:3000/api/conversations/uuid-here/messages?limit=30"
```

---

### 5. Update Conversation

Update conversation title.

**Endpoint**: `PATCH /api/conversations/:conversationId`

**Request Body**:
```json
{
  "title": "New conversation title"
}
```

**Response**:
```json
{
  "conversation": {
    "id": "uuid",
    "title": "New conversation title",
    "updated_at": "2026-02-05T10:30:00Z"
  },
  "message": "Title updated successfully"
}
```

**Example**:
```bash
curl -X PATCH http://localhost:3000/api/conversations/uuid-here \
  -H "Content-Type: application/json" \
  -d '{"title": "Blockchain Basics"}'
```

---

### 6. Delete Conversation

Delete a conversation and all its messages.

**Endpoint**: `DELETE /api/conversations/:conversationId`

**Response**:
```json
{
  "success": true,
  "message": "Conversation deleted successfully"
}
```

**Example**:
```bash
curl -X DELETE http://localhost:3000/api/conversations/uuid-here
```

---

### 7. Get Database Statistics (Admin)

Get statistics about database usage.

**Endpoint**: `GET /api/admin/stats`

**Headers**:
```
Authorization: Bearer <ADMIN_SECRET>
```

**Response**:
```json
{
  "stats": {
    "total_conversations": 150,
    "total_messages": 3500,
    "avg_messages_per_conversation": 23.33,
    "active_conversations_7d": 45,
    "oldest_conversation_days": 15,
    "database_size_mb": 12.5
  }
}
```

**Example**:
```bash
curl http://localhost:3000/api/admin/stats \
  -H "Authorization: Bearer your-admin-secret"
```

---

### 8. Manual Cleanup (Admin)

Manually trigger cleanup of stale conversations (30+ days old).

**Endpoint**: `POST /api/admin/cleanup`

**Headers**:
```
Authorization: Bearer <ADMIN_SECRET>
```

**Request Body** (optional):
```json
{
  "maxDelete": 100
}
```

**Response**:
```json
{
  "success": true,
  "deletedCount": 5,
  "message": "Deleted 5 stale conversation(s)"
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H "Authorization: Bearer your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"maxDelete": 50}'
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message here"
}
```

**Common Status Codes**:
- `400` - Bad request (missing parameters)
- `401` - Unauthorized (admin endpoints)
- `404` - Not found
- `500` - Server error
- `503` - Service unavailable (Supabase not configured)

---

## Usage Examples

### Complete Chat Flow

```javascript
// 1. Start new conversation
const startChat = async () => {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'blockchain-agent',
      userId: 'user-123',
      message: 'What is Ethereum?'
    })
  });
  
  const data = await response.json();
  console.log('AI:', data.message);
  return data.conversationId; // Save this for next message
};

// 2. Continue conversation
const continueChat = async (conversationId) => {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'blockchain-agent',
      userId: 'user-123',
      message: 'Tell me more about gas fees',
      conversationId // Use same conversation ID
    })
  });
  
  const data = await response.json();
  console.log('AI:', data.message);
};

// 3. View conversation history
const viewHistory = async (conversationId) => {
  const response = await fetch(
    `http://localhost:3000/api/conversations/${conversationId}/messages`
  );
  
  const data = await response.json();
  data.messages.forEach(msg => {
    console.log(`${msg.role}: ${msg.content}`);
  });
};
```

---

## Features

✅ **Automatic Message Cleanup** - Keeps only last 30 messages per conversation  
✅ **Token Management** - Respects AI model token limits (8000 tokens)  
✅ **Stale Conversation Cleanup** - Auto-deletes conversations older than 30 days  
✅ **Row Level Security** - Users can only access their own conversations  
✅ **Fast Context Building** - Efficient message retrieval and token estimation  
✅ **Admin Monitoring** - Track database usage and run manual cleanup  

---

## Configuration

Set these in your `.env` file:

```env
# Required
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_api_key

# Optional
ADMIN_SECRET=your_admin_secret
PORT=3000
```

---

## Rate Limits

- **Groq Free Tier**: 30 requests/minute
- **Supabase Free Tier**: 500 MB database, 2 GB bandwidth/month
- **Auto-cleanup**: Runs probabilistically (1% per message) to prevent buildup

---

## Best Practices

1. **Always provide userId and agentId** for proper tracking
2. **Reuse conversationId** to maintain context across messages
3. **Set custom systemPrompt** for specialized agents
4. **Monitor database stats** periodically via admin endpoint
5. **Clean up old conversations** before hitting storage limits

---

## Troubleshooting

**503 Service Unavailable**:
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`
- Verify Supabase project is running

**AI Response Errors**:
- Check `GROQ_API_KEY` is valid
- Verify Groq API quota/rate limits

**Database Full**:
- Run manual cleanup: `POST /api/admin/cleanup`
- Check stats: `GET /api/admin/stats`
- Consider reducing retention period in schema

---

## Next Steps

1. **Frontend Integration**: Build chat UI using these endpoints
2. **Streaming**: Add streaming responses for better UX
3. **Tool Calls**: Integrate with blockchain operations
4. **Analytics**: Track conversation metrics
5. **Export**: Add conversation export feature

---

For more details, see [SETUP_GUIDE.md](SETUP_GUIDE.md)

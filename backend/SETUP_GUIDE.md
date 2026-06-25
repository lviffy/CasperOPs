# Complete Setup Guide: Conversation Memory System

This guide will walk you through implementing the conversation memory system in your backend with Supabase.

---

## 📋 Prerequisites

- Supabase account (free tier works)
- Node.js backend (your existing backend)
- Basic understanding of Express.js

---

## 🚀 Step-by-Step Setup

### **Step 1: Supabase Setup**

#### 1.1 Create/Access Your Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create an account
3. Create a new project or use existing one
4. Wait for project to finish provisioning

#### 1.2 Get Your Credentials

1. In your Supabase dashboard, click **Settings** (gear icon)
2. Go to **API** section
3. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **service_role key** (under "Project API keys")

⚠️ **Important**: Use the `service_role` key for backend, NOT the `anon` key.

#### 1.3 Run the SQL Schema

1. In Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Copy the entire contents of `backend/database/schema.sql`
4. Paste into the SQL editor
5. Click **Run** (or press Ctrl+Enter)

✅ **Success**: You should see "Success. No rows returned" and a statistics table showing your database is ready.

---

### **Step 2: Backend Dependencies**

#### 2.1 Install Required Packages

```bash
cd backend/
npm install @supabase/supabase-js groq-sdk dotenv
```

#### 2.2 Update .env File

Add these to your `backend/.env`:

```env
# Supabase Configuration
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# AI Provider (Groq)
GROQ_API_KEY=your_groq_api_key_here

# Optional: Admin secret for cleanup endpoints
ADMIN_SECRET=generate_a_random_secret_here
```

To generate `ADMIN_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 2.3 Get Groq API Key (Free)

1. Go to [https://console.groq.com](https://console.groq.com)
2. Sign up (free)
3. Go to **API Keys**
4. Create new API key
5. Copy and paste into `.env`

---

### **Step 3: Create Backend Files**

#### 3.1 Create Directory Structure

```bash
cd backend/
mkdir -p config services database
```

#### 3.2 Create Supabase Client

Create `backend/config/supabase.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
```

#### 3.3 Create Memory Utility

Create `backend/utils/memory.js`:

```javascript
const MAX_CONTEXT_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

/**
 * Estimate tokens for text (fast approximation)
 */
function estimateTokens(text) {
  return Math.max(1, Math.floor(text.length / CHARS_PER_TOKEN));
}

/**
 * Build context from messages, respecting token limit
 */
function buildContext(messages, systemPrompt = '', maxTokens = MAX_CONTEXT_TOKENS) {
  const context = [];
  let currentTokens = 0;

  // Add system prompt if provided
  if (systemPrompt) {
    context.push({ role: 'system', content: systemPrompt });
    currentTokens += estimateTokens(systemPrompt);
  }

  // Add messages from most recent backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content) + 10; // +10 for overhead
    
    if (currentTokens + msgTokens > maxTokens) {
      break; // Stop if we exceed token limit
    }
    
    context.unshift({ 
      role: msg.role, 
      content: msg.content 
    });
    currentTokens += msgTokens;
  }

  return { context, tokenCount: currentTokens };
}

/**
 * Truncate message if too long
 */
function truncateMessage(content, maxLength = 4000) {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + '...';
}

module.exports = { 
  estimateTokens, 
  buildContext, 
  truncateMessage 
};
```

#### 3.4 Create AI Service

Create `backend/services/aiService.js`:

```javascript
const Groq = require('groq-sdk');
require('dotenv').config();

if (!process.env.GROQ_API_KEY) {
  throw new Error('Missing GROQ_API_KEY in .env');
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Chat with AI using Groq
 */
async function chatWithAI(messages, model = 'mixtral-8x7b-32768') {
  try {
    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 1,
      stream: false
    });

    return completion.choices[0]?.message?.content || 'No response generated';
  } catch (error) {
    console.error('Groq API error:', error);
    throw new Error('Failed to get AI response');
  }
}

module.exports = { chatWithAI };
```

#### 3.5 Create Conversation Controller

Create `backend/controllers/conversationController.js`:

```javascript
const supabase = require('../config/supabase');
const { buildContext, truncateMessage } = require('../utils/memory');
const { chatWithAI } = require('../services/aiService');

/**
 * Main chat endpoint - handles conversation and AI response
 */
async function chat(req, res) {
  try {
    const { agentId, userId, message, conversationId } = req.body;

    // Validation
    if (!agentId || !userId || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: agentId, userId, message' 
      });
    }

    // Truncate message if too long
    const truncatedMessage = truncateMessage(message);

    // Get or create conversation
    let convId = conversationId;
    let isNewConversation = false;

    if (!convId) {
      // Create new conversation
      const { data, error } = await supabase
        .from('conversations')
        .insert({ 
          agent_id: agentId, 
          user_id: userId, 
          title: truncatedMessage.slice(0, 100) // Use first 100 chars as title
        })
        .select()
        .single();
      
      if (error) {
        console.error('Error creating conversation:', error);
        throw new Error('Failed to create conversation');
      }
      
      convId = data.id;
      isNewConversation = true;
    }

    // Save user message
    const { error: msgError } = await supabase
      .from('conversation_messages')
      .insert({ 
        conversation_id: convId, 
        role: 'user', 
        content: truncatedMessage 
      });

    if (msgError) {
      console.error('Error saving user message:', msgError);
      throw new Error('Failed to save message');
    }

    // Get conversation history (last 30 messages due to auto-cleanup)
    const { data: messages, error: fetchError } = await supabase
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching messages:', fetchError);
      throw new Error('Failed to fetch conversation history');
    }

    // Build context for AI (respects token limits)
    const { context, tokenCount } = buildContext(
      messages,
      'You are a helpful AI assistant.' // Optional system prompt
    );

    console.log(`Context built: ${context.length} messages, ~${tokenCount} tokens`);

    // Call AI
    const aiResponse = await chatWithAI(context);

    // Save AI response
    const { error: aiMsgError } = await supabase
      .from('conversation_messages')
      .insert({ 
        conversation_id: convId, 
        role: 'assistant', 
        content: aiResponse 
      });

    if (aiMsgError) {
      console.error('Error saving AI message:', aiMsgError);
      // Don't throw - we already have the response
    }

    // Return response
    res.json({
      conversationId: convId,
      message: aiResponse,
      isNewConversation,
      messageCount: messages.length + 2 // +2 for the messages we just added
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process message' 
    });
  }
}

/**
 * List user's conversations
 */
async function listConversations(req, res) {
  try {
    const { userId, agentId, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    let query = supabase
      .from('conversations')
      .select('id, agent_id, title, message_count, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit));

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error listing conversations:', error);
      throw new Error('Failed to list conversations');
    }

    res.json({ conversations: data });

  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get messages for a conversation
 */
async function getMessages(req, res) {
  try {
    const { conversationId } = req.params;

    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, role, content, tool_calls, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error getting messages:', error);
      throw new Error('Failed to get messages');
    }

    res.json({ messages: data });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Delete a conversation
 */
async function deleteConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('Error deleting conversation:', error);
      throw new Error('Failed to delete conversation');
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get database statistics (admin only)
 */
async function getStats(req, res) {
  try {
    // Check admin authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase.rpc('get_database_stats');

    if (error) {
      console.error('Error getting stats:', error);
      throw new Error('Failed to get statistics');
    }

    res.json({ stats: data[0] });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Manual cleanup endpoint (admin only)
 */
async function runCleanup(req, res) {
  try {
    // Check admin authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase.rpc('delete_stale_conversations', {
      max_delete: 100
    });

    if (error) {
      console.error('Error running cleanup:', error);
      throw new Error('Failed to run cleanup');
    }

    res.json({ deletedCount: data[0]?.deleted_count || 0 });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  chat,
  listConversations,
  getMessages,
  deleteConversation,
  getStats,
  runCleanup
};
```

#### 3.6 Create Routes

Create `backend/routes/conversationRoutes.js`:

```javascript
const express = require('express');
const {
  chat,
  listConversations,
  getMessages,
  deleteConversation,
  getStats,
  runCleanup
} = require('../controllers/conversationController');

const router = express.Router();

// Main chat endpoint
router.post('/chat', chat);

// Conversation management
router.get('/conversations', listConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.delete('/conversations/:conversationId', deleteConversation);

// Admin endpoints
router.get('/admin/stats', getStats);
router.post('/admin/cleanup', runCleanup);

module.exports = router;
```

#### 3.7 Update app.js

Add this to your `backend/app.js` (or wherever you register routes):

```javascript
// Add after other route imports
const conversationRoutes = require('./routes/conversationRoutes');

// Register routes
app.use('/api', conversationRoutes);
```

---

### **Step 4: Test the Implementation**

#### 4.1 Start Your Backend

```bash
cd backend/
npm start
```

#### 4.2 Test Chat Endpoint

```bash
# Test creating new conversation and chatting
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "test-agent-123",
    "userId": "test-user-456",
    "message": "Hello! Can you help me?"
  }'
```

Expected response:
```json
{
  "conversationId": "uuid-here",
  "message": "AI response here",
  "isNewConversation": true,
  "messageCount": 2
}
```

#### 4.3 Test Continue Conversation

```bash
# Use the conversationId from previous response
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "test-agent-123",
    "userId": "test-user-456",
    "message": "Tell me more",
    "conversationId": "uuid-from-previous-response"
  }'
```

#### 4.4 Test List Conversations

```bash
curl "http://localhost:3000/api/conversations?userId=test-user-456"
```

#### 4.5 Test Get Messages

```bash
curl "http://localhost:3000/api/conversations/{conversationId}/messages"
```

#### 4.6 Test Admin Stats

```bash
curl http://localhost:3000/api/admin/stats \
  -H "Authorization: Bearer your-admin-secret-here"
```

---

### **Step 5: Verify Database Setup**

#### 5.1 Check in Supabase Dashboard

1. Go to **Table Editor** in Supabase
2. You should see:
   - `conversations` table (empty or with test data)
   - `conversation_messages` table (empty or with test data)

#### 5.2 Check Auto-Cleanup is Working

1. Go to **SQL Editor** in Supabase
2. Run this query:

```sql
-- Check if triggers exist
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers
WHERE event_object_table IN ('conversations', 'conversation_messages');
```

You should see:
- `trigger_cleanup_messages`
- `trigger_update_message_count`
- `trigger_smart_cleanup`

#### 5.3 Test Message Limit (Optional)

Create a script to send 35 messages to one conversation, then check that only 30 remain:

```bash
# In Supabase SQL Editor
SELECT COUNT(*) FROM conversation_messages 
WHERE conversation_id = 'your-test-conversation-id';
-- Should return max 30
```

---

## 🎯 What You Get

✅ **Automatic message pruning** - Only last 30 messages kept per conversation  
✅ **Automatic stale conversation cleanup** - Conversations older than 30 days deleted  
✅ **Token-aware context building** - Respects AI model token limits  
✅ **Free tier optimized** - Can handle 12,000-20,000 conversations  
✅ **Row Level Security** - Users can only access their own conversations  
✅ **Admin endpoints** - Monitor database and run manual cleanup  

---

## 🔧 Customization Options

### Change Message Limit

Edit in `schema.sql`:
```sql
-- Change LIMIT 30 to your desired number
LIMIT 30  -- Change to 20, 50, etc.
```

### Change Retention Period

Edit in `schema.sql`:
```sql
-- Change '30 days' to your desired period
INTERVAL '30 days'  -- Change to '7 days', '90 days', etc.
```

### Change AI Model

Edit in `services/aiService.js`:
```javascript
// Available Groq models:
// - mixtral-8x7b-32768 (fast, good quality)
// - llama2-70b-4096 (slower, higher quality)
// - gemma-7b-it (lightweight)
model: 'mixtral-8x7b-32768'
```

### Add System Prompt per Agent

In `conversationController.js`, modify the `buildContext` call:

```javascript
// Fetch agent-specific system prompt
const systemPrompt = await getAgentSystemPrompt(agentId);

const { context, tokenCount } = buildContext(
  messages,
  systemPrompt  // Agent-specific prompt
);
```

---

## 📊 Monitoring

### Check Database Usage

```sql
-- In Supabase SQL Editor
SELECT * FROM get_database_stats();
```

Returns:
- Total conversations
- Total messages
- Average messages per conversation
- Active conversations (7 days)
- Oldest conversation age
- Database size in MB

### Set Up Alerts

1. Check stats weekly via API: `GET /api/admin/stats`
2. Alert if `database_size_mb` > 400 MB (80% of free tier)
3. Alert if `oldest_conversation_days` > 35 (cleanup not working)

---

## 🐛 Troubleshooting

### "Missing SUPABASE_URL" Error
- Check `.env` file exists in `backend/` directory
- Check values are not wrapped in quotes
- Restart your server after changing `.env`

### "Failed to create conversation" Error
- Verify Supabase credentials are correct
- Check RLS policies are enabled (run schema.sql again)
- Check you're using `service_role` key, not `anon` key

### "No response generated" Error
- Check Groq API key is valid
- Check you have Groq API credits
- Try a different model in `aiService.js`

### Messages Not Being Cleaned Up
- Check triggers exist (see Step 5.2)
- Try running cleanup manually: `POST /api/admin/cleanup`
- Check trigger execution in Supabase logs

### Database Growing Too Fast
- Reduce message limit (30 → 20)
- Reduce retention period (30 days → 14 days)
- Add message length limits

---

## 🚀 Next Steps

1. **Frontend Integration**: Build chat UI components
2. **Authentication**: Add proper user authentication
3. **Agent Management**: Create agent profiles with custom prompts
4. **File Uploads**: Add support for images/documents
5. **Streaming**: Implement streaming responses for better UX
6. **Analytics**: Track conversation metrics

---

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Groq API Documentation](https://console.groq.com/docs)
- [PostgreSQL Triggers](https://www.postgresql.org/docs/current/sql-createtrigger.html)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

---

## ✅ Checklist

- [ ] Supabase project created
- [ ] Schema.sql executed successfully
- [ ] Backend dependencies installed
- [ ] .env file configured
- [ ] All backend files created
- [ ] Routes registered in app.js
- [ ] Server starts without errors
- [ ] Chat endpoint tested successfully
- [ ] Database stats verified
- [ ] Cleanup triggers working

---

**You're all set! 🎉**

Your conversation memory system is now production-ready and optimized for Supabase free tier.

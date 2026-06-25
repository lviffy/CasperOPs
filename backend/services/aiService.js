const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Load all 3 Groq API keys with fallback
const GROQ_KEYS = [
  process.env.GROQ_API_KEY1,
  process.env.GROQ_API_KEY2,
  process.env.GROQ_API_KEY3
].filter(key => key); // Remove undefined/null keys

if (GROQ_KEYS.length === 0) {
  console.warn('⚠️  Warning: No GROQ_API_KEY (1-3) set in .env');
} else {
  console.log(`✓ Loaded ${GROQ_KEYS.length} Groq API key(s)`);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  Warning: GEMINI_API_KEY not set in .env');
}

// Create Groq clients for all available keys
const groqClients = GROQ_KEYS.map(key => new Groq({ apiKey: key }));

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

/**
 * Chat with AI using Groq
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} model - Model to use
 * @param {Object} options - Additional options
 * @returns {Promise<string>} AI response
 */
async function chatWithAI(messages, model = 'moonshotai/kimi-k2-instruct-0905', options = {}) {
  // Try all Groq keys in sequence
  if (groqClients.length > 0) {
    let lastError = null;
    
    for (let i = 0; i < groqClients.length; i++) {
      try {
        console.log(`🔑 Trying Groq API key ${i + 1}/${groqClients.length}...`);
        const { maxTokens, temperature, topP, ...restOptions } = options;
        
        const completion = await groqClients[i].chat.completions.create({
          model,
          messages,
          temperature: temperature || 0.7,
          max_tokens: maxTokens || 1024,
          top_p: topP || 1,
          stream: false,
          ...restOptions
        });

        console.log(`✓ Groq API key ${i + 1} succeeded`);
        return completion.choices[0]?.message?.content || 'No response generated';
      } catch (error) {
        lastError = error;
        console.error(`❌ Groq API key ${i + 1} error:`, {
          message: error.message,
          status: error.status,
          statusCode: error.statusCode,
          code: error.code,
          type: error.error?.type
        });
        
        // Check if it's a rate limit error (multiple possible formats)
        const isRateLimit = 
          error.status === 429 ||
          error.statusCode === 429 ||
          error.code === 'rate_limit_exceeded' ||
          error.error?.type === 'rate_limit_exceeded' ||
          error.message?.includes('rate_limit') || 
          error.message?.includes('429') ||
          error.message?.toLowerCase().includes('rate limit');
        
        if (isRateLimit) {
          console.log(`⚠️  Groq key ${i + 1} rate limit exceeded - trying next key or fallback...`);
          // Continue to next key or fallback to Gemini after loop
          continue;
        }
        
        // Check for invalid API key
        const isInvalidKey = 
          error.status === 401 ||
          error.statusCode === 401 ||
          error.message?.includes('invalid_api_key') || 
          error.message?.includes('Invalid API Key') ||
          error.message?.includes('authentication');
        
        if (isInvalidKey) {
          console.log(`⚠️  Groq key ${i + 1} is invalid - trying next key...`);
          continue;
        }
        
        // For other errors, also try next key
        console.log(`⚠️  Groq key ${i + 1} failed with other error - trying next key...`);
        continue;
      }
    }
    
    // If we got here, all Groq keys failed - try Gemini fallback
    console.log('⚠️  All Groq keys failed. Attempting Gemini fallback...');
    if (genAI) {
      try {
        console.log('🔄 Falling back to Gemini...');
        return await chatWithGemini(messages, options);
      } catch (geminiError) {
        console.error('❌ Gemini fallback also failed:', geminiError.message);
        throw new Error(`All AI providers failed. Last Groq error: ${lastError?.message || 'Unknown'}. Gemini error: ${geminiError.message}`);
      }
    } else {
      console.error('❌ No Gemini configured for fallback');
      throw new Error(`All Groq API keys failed. Last error: ${lastError?.message || 'Rate limit exceeded'}. Please configure GEMINI_API_KEY as fallback or try again later.`);
    }
  }
  
  // If Groq not configured, try Gemini
  if (genAI) {
    console.log('ℹ️  Using Gemini (Groq not configured)');
    return await chatWithGemini(messages, options);
  }
  
  throw new Error('No AI provider configured. Please set GROQ_API_KEY1-3 or GEMINI_API_KEY in .env');
}

/**
 * Chat with Gemini AI (fallback)
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Additional options
 * @returns {Promise<string>} AI response
 */
async function chatWithGemini(messages, options = {}) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3.1-flash-lite-preview',
      generationConfig: {
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 1024,
      }
    });

    // Convert messages to Gemini format
    const geminiMessages = messages.filter(m => m.role !== 'system');
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    
    // Build conversation history
    const history = geminiMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    
    const lastMessage = geminiMessages[geminiMessages.length - 1];
    const chat = model.startChat({ history });
    
    const prompt = systemPrompt 
      ? `${systemPrompt}\n\n${lastMessage.content}`
      : lastMessage.content;
    
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API error:', error.message);
    throw new Error(`Gemini service error: ${error.message}`);
  }
}

/**
 * Get available models
 * @returns {Array} Available model names
 */
function getAvailableModels() {
  return [
    'llama-3.1-70b-versatile',  // Fast, high quality (recommended)
    'llama-3.1-8b-instant',     // Fastest, lightweight
    'llama3-70b-8192',          // High quality
    'llama3-8b-8192',           // Balanced
    'gemma2-9b-it'              // Lightweight alternative
  ];
}

module.exports = { 
  chatWithAI,
  chatWithGemini,
  getAvailableModels
};

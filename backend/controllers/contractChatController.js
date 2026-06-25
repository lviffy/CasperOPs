const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  GROQ_API_KEY,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  ETHERSCAN_API_KEY,
  ETHERSCAN_V2_BASE_URL,
  ARBITRUM_SEPOLIA_CHAIN_ID
} = require('../config/constants');
const {
  successResponse,
  errorResponse,
  validateRequiredFields,
  logTransaction
} = require('../utils/helpers');

// Initialize AI clients
let groqClient = null;
if (GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: GROQ_API_KEY });
  console.log('✓ Groq client initialized for Contract Chat');
}

/**
 * Format ABI into human-readable function signatures for the AI prompt
 * @param {Array} abi - Contract ABI
 * @returns {string} Formatted function list
 */
function formatABIForPrompt(abi) {
  if (!Array.isArray(abi)) return 'No ABI available';

  const sections = [];

  // Functions
  const functions = abi.filter(item => item.type === 'function');
  if (functions.length > 0) {
    sections.push('## Functions');
    functions.forEach(func => {
      const inputs = (func.inputs || [])
        .map(i => `${i.type} ${i.name || 'param'}`)
        .join(', ');
      const outputs = (func.outputs || [])
        .map(o => `${o.type} ${o.name || ''}`.trim())
        .join(', ');
      const mutability = func.stateMutability || 'nonpayable';
      sections.push(`- \`${func.name}(${inputs})\` → (${outputs}) [${mutability}]`);
    });
  }

  // Events
  const events = abi.filter(item => item.type === 'event');
  if (events.length > 0) {
    sections.push('\n## Events');
    events.forEach(evt => {
      const inputs = (evt.inputs || [])
        .map(i => `${i.indexed ? 'indexed ' : ''}${i.type} ${i.name || ''}`.trim())
        .join(', ');
      sections.push(`- \`${evt.name}(${inputs})\``);
    });
  }

  // Errors
  const errors = abi.filter(item => item.type === 'error');
  if (errors.length > 0) {
    sections.push('\n## Custom Errors');
    errors.forEach(err => {
      const inputs = (err.inputs || [])
        .map(i => `${i.type} ${i.name || ''}`.trim())
        .join(', ');
      sections.push(`- \`${err.name}(${inputs})\``);
    });
  }

  return sections.join('\n');
}

/**
 * Build the system prompt for the contract chatbot
 * @param {string} contractAddress - The contract address
 * @param {Array} abi - Contract ABI
 * @returns {string} System prompt
 */
function buildSystemPrompt(contractAddress, abi) {
  const formattedABI = formatABIForPrompt(abi);

  return `You are an expert smart contract analyst and assistant for the BlockOps Contract Explorer. You help users understand smart contracts deployed on Arbitrum Sepolia.

You are currently analyzing a contract at address: ${contractAddress}

Here is the contract's ABI (Application Binary Interface):

${formattedABI}

Your capabilities:
1. **Explain** what the contract does based on its functions, events, and errors
2. **Describe** individual functions — what they do, their parameters, and return values
3. **Identify** common patterns (ERC-20, ERC-721, ERC-1155, access control, proxy patterns, etc.)
4. **Explain** state mutability (view/pure vs state-changing functions)
5. **Warn** about potentially dangerous functions (e.g., selfdestruct, unguarded admin functions)
6. **Suggest** how to interact with the contract safely

Guidelines:
- Be concise but thorough — this is a small chat widget, not a full page
- Use **bold** for emphasis and \`code\` for function/type names
- Use bullet points for lists, but keep them short
- Do NOT use horizontal rules (--- or ===) or overly long separators
- Do NOT repeat the contract address unless specifically asked
- Use short headers (##) sparingly — prefer bold text for section labels
- When explaining functions, mention parameter types and what they represent
- If you recognize a standard interface (ERC-20, etc.), mention it
- If the user asks about something not in the ABI, say so clearly
- Never make up functions or capabilities that aren't in the ABI
- Do NOT attempt to execute any functions — only explain and advise`;
}

/**
 * Send a chat question to AI and get a response
 * @param {string} systemPrompt - The system prompt with contract context
 * @param {Array} chatHistory - Previous chat messages [{role, content}]
 * @param {string} question - The user's current question
 * @returns {Promise<string>} AI response
 */
async function getAIResponse(systemPrompt, chatHistory, question) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    })),
    { role: 'user', content: question }
  ];

  let aiResponse = null;

  // Try Groq first (Primary)
  if (groqClient) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.5,
        max_tokens: 2000
      });

      aiResponse = completion.choices[0].message.content;
      console.log('Contract chat response from Groq (Primary)');
    } catch (groqError) {
      console.error('Groq failed for contract chat, trying fallbacks:', groqError.message);
    }
  }

  // Fallback to Gemini
  if (!aiResponse && GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

      // Gemini uses a different format — combine system prompt with first message
      const geminiPrompt = `${systemPrompt}\n\n---\n\nConversation so far:\n${
        chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')
      }\n\nUser: ${question}\n\nAssistant:`;

      const result = await model.generateContent(geminiPrompt);
      const response = await result.response;
      aiResponse = response.text();
      console.log('Contract chat response from Gemini (Fallback)');
    } catch (geminiError) {
      console.error('Gemini failed for contract chat:', geminiError.message);
    }
  }

  // Final fallback to OpenAI
  if (!aiResponse && OPENAI_API_KEY) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages,
        temperature: 0.5,
        max_tokens: 2000
      });

      aiResponse = completion.choices[0].message.content;
      console.log('Contract chat response from OpenAI (Fallback)');
    } catch (openaiError) {
      console.error('OpenAI failed for contract chat:', openaiError.message);
    }
  }

  if (!aiResponse) {
    throw new Error('No AI API key configured. Please set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.');
  }

  return aiResponse;
}

/**
 * Contract Chat: Ask a question about a loaded contract
 * POST /contract-chat/ask
 */
async function ask(req, res) {
  try {
    const {
      contractAddress,
      question,
      abi,
      chatHistory = []
    } = req.body;

    // Validate required fields
    const validationError = validateRequiredFields(req.body, [
      'contractAddress',
      'question',
      'abi'
    ]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    if (!Array.isArray(abi) || abi.length === 0) {
      return res.status(400).json(
        errorResponse('ABI must be a non-empty array')
      );
    }

    logTransaction('Contract Chat Question', { contractAddress, question });

    // Build the system prompt with contract context
    const systemPrompt = buildSystemPrompt(contractAddress, abi);

    // Get AI response
    const answer = await getAIResponse(systemPrompt, chatHistory, question);

    return res.json(
      successResponse({
        data: {
          answer,
          contractAddress,
          question
        },
        message: 'Question answered successfully'
      })
    );
  } catch (error) {
    console.error('Contract chat error:', error);
    return res.status(500).json(
      errorResponse('Failed to answer question', error.message)
    );
  }
}

module.exports = {
  ask
};

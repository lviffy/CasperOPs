const axios = require('axios');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GROQ_API_KEY, GEMINI_API_KEY } = require('../config/constants');

// Initialize AI clients
let groqClient = null;
let geminiClient = null;

if (GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: GROQ_API_KEY });
  console.log('✓ Groq client initialized for price parsing (Primary)');
}

if (GEMINI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
  console.log('✓ Gemini client initialized for price parsing (Fallback)');
}

// CoinGecko API base URL (free tier, no API key required)
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Common cryptocurrency mappings
const CRYPTO_MAPPINGS = {
  'btc': 'bitcoin',
  'bitcoin': 'bitcoin',
  'eth': 'ethereum',
  'ethereum': 'ethereum',
  'usdt': 'tether',
  'tether': 'tether',
  'bnb': 'binancecoin',
  'binance': 'binancecoin',
  'sol': 'solana',
  'solana': 'solana',
  'xrp': 'ripple',
  'ripple': 'ripple',
  'ada': 'cardano',
  'cardano': 'cardano',
  'doge': 'dogecoin',
  'dogecoin': 'dogecoin',
  'avax': 'avalanche-2',
  'avalanche': 'avalanche-2',
  'dot': 'polkadot',
  'polkadot': 'polkadot',
  'matic': 'matic-network',
  'polygon': 'matic-network',
  'link': 'chainlink',
  'chainlink': 'chainlink',
  'uni': 'uniswap',
  'uniswap': 'uniswap',
  'arb': 'arbitrum',
  'arbitrum': 'arbitrum',
  'op': 'optimism',
  'optimism': 'optimism'
};

/**
 * Parse natural language query to extract cryptocurrency names
 */
const parseCryptoQuery = async (query) => {
  const lowerQuery = query.toLowerCase();
  const foundCryptos = [];
  
  // First, try direct matching with our mapping
  for (const [key, value] of Object.entries(CRYPTO_MAPPINGS)) {
    if (lowerQuery.includes(key)) {
      if (!foundCryptos.includes(value)) {
        foundCryptos.push(value);
      }
    }
  }
  
  // If we found cryptos, return them
  if (foundCryptos.length > 0) {
    return foundCryptos;
  }
  
  const aiPrompt = `Extract cryptocurrency names from this query: "${query}"\n\nReturn ONLY a comma-separated list of CoinGecko coin IDs (lowercase, no spaces). Examples: bitcoin, ethereum, solana\n\nIf you can't identify any cryptocurrencies, return "unknown".`;
  
  // Try Groq first (Primary)
  if (groqClient) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: aiPrompt }],
        temperature: 0.1,
        max_tokens: 100
      });
      
      const text = completion.choices[0].message.content.trim().toLowerCase();
      
      if (text !== 'unknown' && text.length > 0) {
        return text.split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
    } catch (error) {
      console.error('Groq parsing error, falling back to Gemini:', error.message);
    }
  }
  
  // Fallback to Gemini
  if (geminiClient) {
    try {
      const model = geminiClient.getGenerativeModel({
        model: 'gemini-3.1-flash-lite-preview',
        generationConfig: {
          temperature: 0.1,
        },
      });

      const result = await model.generateContent(aiPrompt);

      const response = await result.response;
      const text = response.text().trim().toLowerCase();
      
      if (text !== 'unknown' && text.length > 0) {
        return text.split(',').map(s => s.trim()).filter(s => s.length > 0);
      }
    } catch (error) {
      console.error('Gemini parsing error:', error.message);
    }
  }
  
  // Default fallback to Bitcoin if nothing found
  return ['bitcoin'];
};

/**
 * Fetch price from CoinGecko API
 */
const fetchFromCoinGecko = async (coinIds, vsCurrency = 'usd') => {
  try {
    const ids = coinIds.join(',');
    const url = `${COINGECKO_API_BASE}/simple/price`;
    
    const response = await axios.get(url, {
      params: {
        ids: ids,
        vs_currencies: vsCurrency,
        include_24hr_change: true,
        include_market_cap: true,
        include_24hr_vol: true
      },
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    throw new Error(`CoinGecko API error: ${error.message}`);
  }
};

/**
 * Token price endpoint - fetch current token prices using CoinGecko API
 */
const getTokenPrice = async (req, res) => {
  try {
    const { query, vsCurrency = 'usd' } = req.body;

    // Validation
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required',
        usage: 'Provide a query like "bitcoin price", "ethereum", or "btc eth sol"',
        example: {
          query: "bitcoin price",
          vsCurrency: "usd"
        }
      });
    }

    console.log('Fetching token prices for query:', query);

    // Parse the query to extract cryptocurrency names
    const coinIds = await parseCryptoQuery(query);
    
    if (coinIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No cryptocurrencies identified in query',
        query: query,
        hint: 'Try queries like "bitcoin", "ethereum price", or "btc eth sol"'
      });
    }

    console.log('Identified cryptocurrencies:', coinIds);

    // Fetch prices from CoinGecko
    const priceData = await fetchFromCoinGecko(coinIds, vsCurrency);

    // Format response
    const prices = [];
    for (const coinId of coinIds) {
      if (priceData[coinId]) {
        const data = priceData[coinId];
        prices.push({
          coin: coinId,
          price: data[vsCurrency],
          currency: vsCurrency.toUpperCase(),
          change_24h: data[`${vsCurrency}_24h_change`] || null,
          market_cap: data[`${vsCurrency}_market_cap`] || null,
          volume_24h: data[`${vsCurrency}_24h_vol`] || null
        });
      }
    }

    if (prices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No price data found for the requested cryptocurrencies',
        queried_coins: coinIds
      });
    }

    return res.json({
      success: true,
      query: query,
      prices: prices,
      source: 'CoinGecko API',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Token price error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch token prices'
    });
  }
};

module.exports = {
  getTokenPrice
};

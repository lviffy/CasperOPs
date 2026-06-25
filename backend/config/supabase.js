const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('⚠️  Warning: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  console.warn('   Conversation memory features will not work until configured.');
}

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
  : null;

module.exports = supabase;

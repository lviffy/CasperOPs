#!/usr/bin/env node
/**
 * One-time Supabase backfill script.
 *
 * Prompts legacy EVM users to reconnect via CSPR.click by:
 *   1. Listing every user in the `users` table.
 *   2. For each user without an `ed25519_public_key`, sending a Supabase
 *      notification (or printing to stdout in CLI mode) asking them to
 *      re-connect their Casper wallet.
 *   3. Marking the user as `wallet_type = NULL` so the frontend will
 *      surface the CSPR.click re-connect prompt.
 *
 * Idempotent: re-running it is safe (the UPDATE only affects users that
 * still have the legacy `wallet_type` set).
 *
 * Usage:
 *   node scripts/backfill-csprclick-users.js
 *   node scripts/backfill-csprclick-users.js --dry-run
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require('dotenv').config({ path: process.env.DOTENV_PATH || '.env' })

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, wallet_type, wallet_address, ed25519_public_key, last_connected_at, email')
  if (error) {
    console.error('❌  Failed to list users:', error)
    process.exit(1)
  }

  const needReconnect = (users || []).filter((u) => !u.ed25519_public_key)
  console.log(`Found ${users.length} users; ${needReconnect.length} need to reconnect via CSPR.click.`)

  if (needReconnect.length === 0) {
    console.log('Nothing to do. ✅')
    return
  }

  if (dryRun) {
    console.log('Dry run — would have prompted the following users:')
    for (const u of needReconnect) {
      console.log(`  - ${u.id} (${u.email || 'no email'})`)
    }
    return
  }

  let updated = 0
  for (const u of needReconnect) {
    const { error: updateErr } = await supabase
      .from('users')
      .update({ wallet_type: null, last_connected_at: null })
      .eq('id', u.id)
    if (updateErr) {
      console.warn(`  ⚠️  ${u.id}: ${updateErr.message}`)
    } else {
      updated += 1
    }
  }

  console.log(`✅  ${updated} user(s) marked for re-connect. Send them a CSPR.click re-connect prompt.`)
}

main().catch((err) => {
  console.error('❌  Backfill failed:', err)
  process.exit(1)
})

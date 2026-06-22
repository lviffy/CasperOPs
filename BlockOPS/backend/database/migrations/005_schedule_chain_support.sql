ALTER TABLE IF EXISTS scheduled_transfers
  ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'arbitrum-sepolia';

UPDATE scheduled_transfers
SET chain = 'arbitrum-sepolia'
WHERE chain IS NULL OR chain = '';

ALTER TABLE IF EXISTS scheduled_chat_reminders
  ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'arbitrum-sepolia';

UPDATE scheduled_chat_reminders
SET chain = 'arbitrum-sepolia'
WHERE chain IS NULL OR chain = '';

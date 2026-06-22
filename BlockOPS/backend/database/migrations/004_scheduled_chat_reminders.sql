CREATE TABLE IF NOT EXISTS scheduled_chat_reminders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            TEXT,
  user_id             TEXT NOT NULL,
  conversation_id     TEXT,
  delivery_platform   TEXT NOT NULL CHECK (delivery_platform IN ('web', 'telegram')),
  telegram_chat_id    TEXT,
  task_type           TEXT NOT NULL CHECK (task_type IN ('balance', 'portfolio', 'price')),
  wallet_address      TEXT,
  token_query         TEXT,
  cron_expression     TEXT NOT NULL,
  label               TEXT,
  original_message    TEXT,
  type                TEXT NOT NULL DEFAULT 'recurring' CHECK (type IN ('one_shot', 'recurring')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  run_count           INTEGER NOT NULL DEFAULT 0,
  last_run_at         TIMESTAMPTZ,
  last_error          TEXT,
  last_result_summary TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_reminders_user
  ON scheduled_chat_reminders(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_reminders_agent
  ON scheduled_chat_reminders(agent_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_reminders_status
  ON scheduled_chat_reminders(status);

CREATE TABLE IF NOT EXISTS scheduled_chat_reminder_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id  UUID NOT NULL REFERENCES scheduled_chat_reminders(id) ON DELETE CASCADE,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success      BOOLEAN NOT NULL DEFAULT FALSE,
  message_text TEXT,
  error        TEXT,
  tool_results JSONB
);

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_reminder_logs_reminder
  ON scheduled_chat_reminder_logs(reminder_id, ran_at DESC);

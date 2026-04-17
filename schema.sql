-- ============================================================
-- Poker Chip Management Bot — Supabase Schema
-- Run this in the Supabase SQL editor
-- ============================================================

-- Players
CREATE TABLE IF NOT EXISTS players (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT UNIQUE NOT NULL,
  username        TEXT,
  player_app_id   TEXT,
  balance         NUMERIC(15, 2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGSERIAL PRIMARY KEY,
  player_id       BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
  amount          NUMERIC(15, 2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  receipt_file_id TEXT,          -- Telegram file_id for deposit receipt photo
  message_id      BIGINT,        -- Admin DM message ID (for reference)
  admin_id        BIGINT,        -- Telegram ID of admin who acted on this
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clubs
CREATE TABLE IF NOT EXISTS clubs (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  club_id         TEXT NOT NULL,
  chip_rate       NUMERIC(10, 4) NOT NULL,  -- chips per currency unit
  bank_name       TEXT NOT NULL,
  bank_account    TEXT NOT NULL,
  account_holder  TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_telegram_id     ON players(telegram_id);
CREATE INDEX IF NOT EXISTS idx_transactions_player_id  ON transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status     ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_clubs_is_active         ON clubs(is_active);

-- ============================================================
-- Disable Row Level Security so the bot's anon key works.
-- If you switch to a service_role key, you can remove these.
-- ============================================================
ALTER TABLE players      DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE clubs        DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Atomic balance helpers (called via supabase.rpc)
-- ============================================================

-- Credit a player's balance (deposit approved)
CREATE OR REPLACE FUNCTION credit_balance(p_player_id BIGINT, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE players
  SET balance = balance + p_amount
  WHERE id = p_player_id;
END;
$$;

-- Debit a player's balance (withdraw approved).
-- Returns TRUE on success, FALSE if balance is insufficient.
CREATE OR REPLACE FUNCTION debit_balance(p_player_id BIGINT, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT balance INTO v_balance FROM players WHERE id = p_player_id FOR UPDATE;
  IF v_balance >= p_amount THEN
    UPDATE players SET balance = balance - p_amount WHERE id = p_player_id;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

-- ============================================================
-- Sample club — edit or remove before going live
-- ============================================================
-- INSERT INTO clubs (name, club_id, chip_rate, bank_name, bank_account, account_holder)
-- VALUES ('Main Club', 'CLUB001', 1.00, 'Bank of Example', '0123456789', 'John Doe');

-- ============================================================
-- Settings — key/value store for runtime config
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settings DISABLE ROW LEVEL SECURITY;

INSERT INTO settings (key, value) VALUES
  ('admin_telegram_id', '1901187181')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Bot messages — editable message templates with placeholders
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_messages (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_messages DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Admins — Telegram users allowed to approve/reject transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS admins (
  id          BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username    TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admins DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_admins_telegram_id ON admins(telegram_id);

-- Seed: promote the existing admin_telegram_id setting as the first admin
INSERT INTO admins (telegram_id, username)
SELECT value::BIGINT, 'admin'
FROM settings
WHERE key = 'admin_telegram_id'
ON CONFLICT (telegram_id) DO NOTHING;

-- ============================================================
-- Bot messages — editable message templates with placeholders
-- ============================================================

INSERT INTO bot_messages (key, value, description) VALUES
  ('deposit_prompt',         'How many chips are you depositing? Please enter the amount:',                                         'Shown after bank details'),
  ('deposit_receipt_prompt', 'Got it — {amount} chips. Now please upload your payment receipt as a photo.',                        'Shown after amount entered'),
  ('deposit_submitted',      '✅ Receipt submitted! Awaiting admin approval.',                                                     'Shown after receipt uploaded'),
  ('deposit_approved',       '✅ {username}, your deposit of {amount} chips has been approved! Your balance has been updated.',    'Sent to group on approval'),
  ('deposit_rejected',       '❌ {username}, your deposit was rejected. Please contact admin.',                                   'Sent to group on rejection'),
  ('withdraw_prompt',        'How many chips would you like to withdraw?',                                                         'First withdraw message'),
  ('withdraw_appid_prompt',  'Got it — {amount} chips. Please enter your Player App ID.',                                         'Shown after withdraw amount'),
  ('withdraw_submitted',     '✅ Withdrawal request submitted! Awaiting admin approval.',                                         'Shown after app ID entered'),
  ('withdraw_approved',      '✅ {username}, your withdrawal of {amount} chips has been approved!',                               'Sent to group on approval'),
  ('withdraw_rejected',      '❌ {username}, your withdrawal request was rejected.',                                              'Sent to group on rejection'),
  ('insufficient_balance',   '❌ {username}, insufficient balance for this withdrawal.',                                          'Sent when balance too low'),
  ('balance_message',        '💰 Balance for {username} — Chips: {balance}',                                                     'Shown for /balance command'),
  ('no_account_message',     'No account found. Use /deposit to get started.',                                                    'Shown when player not found')
ON CONFLICT (key) DO NOTHING;

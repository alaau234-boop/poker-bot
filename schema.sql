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

-- ============================================================
-- Inline-keyboard flow — schema + message updates
-- Run these after the initial schema if updating an existing DB
-- ============================================================

-- Add bank_account column to transactions (for withdrawal requests)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_account TEXT;

-- Partial unique index on player_app_id (NULLs are exempt)
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_app_id
  ON players(player_app_id) WHERE player_app_id IS NOT NULL;

-- New bot_messages keys for the inline-keyboard flow
INSERT INTO bot_messages (key, value, description) VALUES
  ('start_welcome',
   'What would you like to do?',
   'Shown under club list on /start'),

  ('deposit_instructions',
   'To deposit, kindly transfer funds to the bank details shown below and send us your payment receipt.'
   || E'\n\n' || 'Minimum deposit: 20 MVR'
   || E'\n\n' || 'Bank details may be updated from time to time. Please confirm before sending.'
   || E'\n\n' || 'Kindly share your deposit receipt (photo, screenshot, or document).',
   'Shown when Deposit button is tapped (bank details appended by bot)'),

  ('deposit_amount_prompt',
   'Please enter the deposit amount:',
   'Asked after receipt is uploaded'),

  ('deposit_playerid_prompt',
   'Please enter your Player ID:',
   'Asked after deposit amount'),

  ('withdraw_instructions',
   'Before you proceed:'
   || E'\n\n' || E'\u2022 The minimum withdrawal is 200 MVR'
   || E'\n' || E'\u2022 Withdrawals are sent to the same bank account you deposited from',
   'Shown when Withdraw button is tapped'),

  ('withdraw_amount_prompt',
   'How much would you like to withdraw?',
   'Asked after user clicks Proceed'),

  ('withdraw_playerid_prompt',
   'Enter your Player ID:',
   'Asked after withdrawal amount'),

  ('withdraw_bankaccount_prompt',
   'Enter your bank account number:',
   'Asked after withdrawal player ID'),

  ('balance_playerid_prompt',
   'Enter your Player ID to check your balance:',
   'Asked when My Balance button is tapped')
ON CONFLICT (key) DO NOTHING;

-- Update existing messages: remove {username}, use {amount}/{player_id} only
-- DO UPDATE ensures existing deployments also get the corrected values
INSERT INTO bot_messages (key, value, description) VALUES
  ('deposit_submitted',
   'Receipt submitted! Awaiting admin approval.',
   'Shown after receipt submitted'),

  ('deposit_approved',
   'Your deposit of {amount} chips has been approved! Your balance has been updated.',
   'DM sent to player on deposit approval'),

  ('deposit_rejected',
   'Your deposit was rejected. Please contact admin.',
   'DM sent to player on deposit rejection'),

  ('withdraw_submitted',
   'Withdrawal request submitted.'
   || E'\n' || 'Your funds will be transferred within 10-30 minutes.'
   || E'\n\n' || 'Please avoid sending multiple messages. Repeated messages may slow down processing. Thank you for your patience!',
   'Confirmation shown after withdrawal submitted'),

  ('withdraw_approved',
   'Your withdrawal of {amount} chips has been approved!',
   'DM sent to player on withdrawal approval'),

  ('withdraw_rejected',
   'Your withdrawal request was rejected. Please contact admin.',
   'DM sent to player on withdrawal rejection'),

  ('insufficient_balance',
   'Insufficient balance for this withdrawal.',
   'DM sent when withdrawal balance check fails'),

  ('balance_message',
   'Balance for <b>{player_id}</b>: {balance} chips',
   'Shown after balance lookup'),

  ('no_account_message',
   'No account found for that Player ID.',
   'Shown when player_app_id lookup returns nothing')
ON CONFLICT (key) DO UPDATE
  SET value       = EXCLUDED.value,
      description = EXCLUDED.description;

-- ============================================================
-- Join requests — tracks pending Player ID registrations
-- ============================================================

CREATE TABLE IF NOT EXISTS join_requests (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  player_app_id TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  message_id    BIGINT,
  admin_id      BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE join_requests DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_join_requests_telegram_id ON join_requests(telegram_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status      ON join_requests(status);

-- ============================================================
-- Join / Request ID flow — new bot_messages keys
-- ============================================================

INSERT INTO bot_messages (key, value, description) VALUES
  ('join_instructions',
   '🎰 To join a club, use the Club ID below to request access in the app.'
   || E'\n\n' || 'Once you have joined and received your Player ID, enter it below to register with us.',
   'Shown when Request ID / Join Club button is tapped'),

  ('join_playerid_prompt',
   'Enter your Player ID:',
   'Asked after join instructions shown'),

  ('join_confirmed',
   '✅ Your Player ID has been registered. You can now make deposits and withdrawals.',
   'Shown after player ID submitted in join flow'),

  ('not_registered',
   '⚠️ You need to register your Player ID before you can deposit or withdraw.'
   || E'\n\n' || 'Please use the <b>Register / Join Club</b> option first.',
   'Shown when unregistered user tries to deposit or withdraw'),

  ('already_registered',
   '✅ You are already registered with Player ID: <b>{player_id}</b>',
   'Shown when user tries to register again but already has a Player ID'),

  ('join_submitted',
   '✅ Request received! Awaiting admin approval.'
   || E'\n\n' || '⏳ Please avoid sending multiple messages. Thank you for your patience!',
   'Shown after player submits Player ID for registration'),

  ('join_approved',
   '✅ Your Player ID has been approved! You can now deposit and withdraw.',
   'DM sent to player when join request is approved'),

  ('join_rejected',
   '❌ Your Player ID request was rejected. Please contact admin.',
   'DM sent to player when join request is rejected')
ON CONFLICT (key) DO UPDATE
  SET value       = EXCLUDED.value,
      description = EXCLUDED.description;

-- ============================================================
-- Add emojis to all bot messages — DO UPDATE so existing
-- deployments also receive the updated text.
-- ============================================================

INSERT INTO bot_messages (key, value, description) VALUES
  ('deposit_instructions',
   'To deposit, kindly transfer funds to the bank details shown below and send us your payment receipt.'
   || E'\n\n' || 'Minimum deposit: 20 MVR'
   || E'\n\n' || 'Bank details may be updated from time to time. Please confirm before sending.'
   || E'\n\n' || '📸 Kindly share your deposit receipt (photo, screenshot, or document).',
   'Shown when Deposit button is tapped (bank details appended by bot)'),

  ('deposit_amount_prompt',
   '💰 Please enter the deposit amount:',
   'Asked after receipt is uploaded'),

  ('deposit_submitted',
   '✅ Receipt submitted! Awaiting admin approval.',
   'Shown after receipt submitted'),

  ('deposit_approved',
   '✅ Your deposit of {amount} chips has been approved! Your balance has been updated.',
   'DM sent to player on deposit approval'),

  ('deposit_rejected',
   '❌ Your deposit was rejected. Please contact admin.',
   'DM sent to player on deposit rejection'),

  ('withdraw_instructions',
   '⚠️ Before you proceed:'
   || E'\n\n' || E'\u2022 The minimum withdrawal is 200 MVR'
   || E'\n' || E'\u2022 Withdrawals are sent to the same bank account you deposited from',
   'Shown when Withdraw button is tapped'),

  ('withdraw_amount_prompt',
   '💰 How much would you like to withdraw?',
   'Asked after user clicks Proceed'),

  ('withdraw_submitted',
   '⏳ Withdrawal request submitted.'
   || E'\n' || 'Your funds will be transferred within 10-30 minutes.'
   || E'\n\n' || 'Please avoid sending multiple messages. Repeated messages may slow down processing. Thank you for your patience!',
   'Confirmation shown after withdrawal submitted'),

  ('withdraw_approved',
   '✅ Your withdrawal of {amount} chips has been approved!',
   'DM sent to player on withdrawal approval'),

  ('withdraw_rejected',
   '❌ Your withdrawal request was rejected. Please contact admin.',
   'DM sent to player on withdrawal rejection'),

  ('insufficient_balance',
   '❌ Insufficient balance for this withdrawal.',
   'DM sent when withdrawal balance check fails'),

  ('balance_message',
   '💰 Balance for <b>{player_id}</b>: {balance} chips',
   'Shown after balance lookup'),

  ('no_account_message',
   '⚠️ No account found for that Player ID.',
   'Shown when player_app_id lookup returns nothing')
ON CONFLICT (key) DO UPDATE
  SET value       = EXCLUDED.value,
      description = EXCLUDED.description;

import { createClient } from '@supabase/supabase-js';
import { Club, Player, Transaction } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

// ── Players ───────────────────────────────────────────────────────────────────

/**
 * Fetches a player by Telegram ID, creating one if they don't exist yet.
 * Always syncs the latest username.
 */
export async function getOrCreatePlayer(
  telegramId: number,
  username: string | null,
): Promise<Player> {
  const { data: existing, error: fetchErr } = await supabase
    .from('players')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) {
    // Sync username if it changed
    if (existing.username !== username) {
      const { data, error } = await supabase
        .from('players')
        .update({ username })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      if (error) throw error;
      return data as Player;
    }
    return existing as Player;
  }

  const { data, error } = await supabase
    .from('players')
    .insert({ telegram_id: telegramId, username, balance: 0 })
    .select()
    .single();
  if (error) throw error;
  return data as Player;
}

export async function getPlayerByTelegramId(telegramId: number): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data as Player | null;
}

export async function getPlayerById(playerId: number): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data as Player | null;
}

/**
 * Looks up a player by their in-game player_app_id.
 * If found, updates the stored telegram_id (for DMs) if it has changed.
 * If not found by app ID, falls back to telegram_id and sets the app ID.
 * If neither exists, creates a fresh player record.
 */
export async function getOrCreatePlayerByAppId(
  playerAppId: string,
  telegramId: number,
): Promise<Player> {
  // 1. Try to find by player_app_id
  const { data: byAppId, error: e1 } = await supabase
    .from('players')
    .select('*')
    .eq('player_app_id', playerAppId)
    .maybeSingle();
  if (e1) throw e1;

  if (byAppId) {
    if ((byAppId as Player).telegram_id !== telegramId) {
      const { data, error } = await supabase
        .from('players')
        .update({ telegram_id: telegramId })
        .eq('id', (byAppId as Player).id)
        .select()
        .single();
      if (error) throw error;
      return data as Player;
    }
    return byAppId as Player;
  }

  // 2. Try to find by telegram_id and set the app ID
  const { data: byTelegram, error: e2 } = await supabase
    .from('players')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (e2) throw e2;

  if (byTelegram) {
    const { data, error } = await supabase
      .from('players')
      .update({ player_app_id: playerAppId })
      .eq('id', (byTelegram as Player).id)
      .select()
      .single();
    if (error) throw error;
    return data as Player;
  }

  // 3. Create new player
  const { data, error } = await supabase
    .from('players')
    .insert({ telegram_id: telegramId, player_app_id: playerAppId, balance: 0 })
    .select()
    .single();
  if (error) throw error;
  return data as Player;
}

/** Looks up a player by their in-game player_app_id (no telegram_id required). */
export async function getPlayerByAppId(playerAppId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('player_app_id', playerAppId)
    .maybeSingle();
  if (error) throw error;
  return data as Player | null;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function createTransaction(
  playerId: number,
  type: 'deposit' | 'withdraw',
  amount: number,
  receiptFileId?: string,
  bankAccount?: string,
): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      player_id: playerId,
      type,
      amount,
      status: 'pending',
      receipt_file_id: receiptFileId ?? null,
      bank_account: bankAccount ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

export async function getTransactionById(txId: number): Promise<Transaction | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', txId)
    .maybeSingle();
  if (error) throw error;
  return data as Transaction | null;
}

export async function updateTransactionStatus(
  txId: number,
  status: 'approved' | 'rejected',
  adminId: number,
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ status, admin_id: adminId })
    .eq('id', txId);
  if (error) throw error;
}

export async function updateTransactionMessageId(txId: number, messageId: number): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ message_id: messageId })
    .eq('id', txId);
  if (error) throw error;
}

// ── Balance (atomic via Postgres functions) ───────────────────────────────────

/** Credits a player's chip balance. Calls the credit_balance Postgres function. */
export async function creditBalance(playerId: number, amount: number): Promise<void> {
  const { error } = await supabase.rpc('credit_balance', {
    p_player_id: playerId,
    p_amount: amount,
  });
  if (error) throw error;
}

/**
 * Debits a player's chip balance atomically.
 * Returns `true` on success, `false` if the balance is insufficient.
 */
export async function debitBalance(playerId: number, amount: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('debit_balance', {
    p_player_id: playerId,
    p_amount: amount,
  });
  if (error) throw error;
  return data as boolean;
}

// ── Clubs ─────────────────────────────────────────────────────────────────────

export async function getActiveClubs(): Promise<Club[]> {
  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Club[];
}

// ── Settings & bot messages ───────────────────────────────────────────────────

/** Escapes special HTML characters so user-supplied values are safe in HTML messages. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Fetches a bot message by key from the bot_messages table and substitutes
 * any {placeholder} tokens with the provided replacements.
 * Falls back to "[message: <key>]" if the key doesn't exist.
 */
export async function getBotMessage(
  key: string,
  replacements?: Record<string, string>,
): Promise<string> {
  const { data, error } = await supabase
    .from('bot_messages')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;

  let message = data?.value ?? `[message: ${key}]`;

  if (replacements) {
    for (const [placeholder, value] of Object.entries(replacements)) {
      message = message.split(`{${placeholder}}`).join(escapeHtml(value));
    }
  }

  return message;
}

/** Returns true if the given Telegram ID belongs to an active admin. */
export async function isAdmin(telegramId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('admins')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

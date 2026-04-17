import { Context } from 'telegraf';

// ── Session ──────────────────────────────────────────────────────────────────

export interface SessionData {
  /** Tracks the current conversational step for this user in this chat. */
  step?:
    | 'waiting_deposit_amount'
    | 'waiting_receipt'
    | 'waiting_withdraw_amount'
    | 'waiting_withdraw_app_id';
  /** Deposit amount captured before the receipt photo is sent. */
  depositAmount?: number;
  /** Withdrawal amount captured before the app ID is provided. */
  withdrawAmount?: number;
}

export interface BotContext extends Context {
  session: SessionData;
}

// ── Domain models ─────────────────────────────────────────────────────────────

export interface Player {
  id: number;
  telegram_id: number;
  username: string | null;
  player_app_id: string | null;
  balance: number;
  created_at: string;
}

export interface Transaction {
  id: number;
  player_id: number;
  type: 'deposit' | 'withdraw';
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  receipt_file_id: string | null;
  message_id: number | null;
  admin_id: number | null;
  created_at: string;
}

export interface Club {
  id: number;
  name: string;
  club_id: string;
  chip_rate: number;
  bank_name: string;
  bank_account: string;
  account_holder: string;
  is_active: boolean;
}

import { Context } from 'telegraf';

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionData {
  step?:
    | 'waiting_deposit_receipt'
    | 'waiting_deposit_amount'
    | 'waiting_deposit_player_id'
    | 'waiting_withdraw_amount'
    | 'waiting_withdraw_player_id'
    | 'waiting_withdraw_bank_account'
    | 'waiting_join_player_id';

  /** Telegram file_id of the uploaded deposit receipt. */
  depositReceiptFileId?: string;
  /** True if the receipt was sent as a document rather than a photo. */
  depositReceiptIsDocument?: boolean;
  /** Deposit chip amount captured before player ID is entered. */
  depositAmount?: number;

  /** Withdrawal chip amount captured in step 1. */
  withdrawAmount?: number;
  /** Player app ID captured in step 2 of withdrawal. */
  withdrawPlayerId?: string;
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
  bank_account: string | null;
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

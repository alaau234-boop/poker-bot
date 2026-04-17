import {
  creditBalance,
  debitBalance,
  getBotMessage,
  getPlayerById,
  getTransactionById,
  isAdmin,
  updateTransactionStatus,
} from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

/**
 * Handles ✅ / ❌ inline button presses from admins in the group.
 *
 * Callback data format:  <action>_<type>_<txId>
 *   action : "approve" | "reject"
 *   type   : "dep" (deposit) | "wd" (withdraw)
 *   txId   : numeric transaction ID
 */
export async function handleAdminApproval(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    await ctx.answerCbQuery('⛔ Unauthorized');
    return;
  }

  const actingAdminId = ctx.from.id;
  const data  = ctx.callbackQuery.data;
  const parts = data.split('_'); // ['approve'|'reject', 'dep'|'wd', '<id>']

  if (parts.length !== 3) {
    await ctx.answerCbQuery('Invalid callback data');
    return;
  }

  const [action, type, txIdStr] = parts;
  const txId = parseInt(txIdStr);

  if (
    isNaN(txId) ||
    (action !== 'approve' && action !== 'reject') ||
    (type !== 'dep' && type !== 'wd')
  ) {
    await ctx.answerCbQuery('Invalid callback data');
    return;
  }

  try {
    const transaction = await getTransactionById(txId);
    if (!transaction) {
      await ctx.answerCbQuery('Transaction not found');
      return;
    }

    if (transaction.status !== 'pending') {
      await ctx.answerCbQuery(`Already ${transaction.status}`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      return;
    }

    const player = await getPlayerById(transaction.player_id);
    if (!player) {
      await ctx.answerCbQuery('Player not found');
      return;
    }

    if (action === 'approve') {
      await handleApprove(ctx, transaction.id, type, player.id, transaction.amount, player.telegram_id, actingAdminId);
    } else {
      await updateTransactionStatus(txId, 'rejected', actingAdminId);

      const msgKey = type === 'dep' ? 'deposit_rejected' : 'withdraw_rejected';
      const text   = await getBotMessage(msgKey, { amount: String(transaction.amount) });
      await ctx.telegram.sendMessage(player.telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: mainMenuMarkup,
      });

      await ctx.answerCbQuery('❌ Request rejected');
    }

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
  } catch (err) {
    console.error('[adminApproval] error:', err);
    await ctx.answerCbQuery('An error occurred. Check bot logs.');
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function handleApprove(
  ctx: BotContext,
  txId: number,
  type: string,
  playerId: number,
  amount: number,
  playerTelegramId: number,
  adminId: number,
): Promise<void> {
  if (type === 'dep') {
    await creditBalance(playerId, amount);
    await updateTransactionStatus(txId, 'approved', adminId);

    const text = await getBotMessage('deposit_approved', { amount: String(amount) });
    await ctx.telegram.sendMessage(playerTelegramId, text, {
      parse_mode: 'HTML',
      reply_markup: mainMenuMarkup,
    });

    await ctx.answerCbQuery('✅ Deposit approved');
  } else {
    const success = await debitBalance(playerId, amount);

    if (!success) {
      await updateTransactionStatus(txId, 'rejected', adminId);

      const text = await getBotMessage('insufficient_balance', { amount: String(amount) });
      await ctx.telegram.sendMessage(playerTelegramId, text, {
        parse_mode: 'HTML',
        reply_markup: mainMenuMarkup,
      });

      await ctx.answerCbQuery('Insufficient balance — request rejected');
      return;
    }

    await updateTransactionStatus(txId, 'approved', adminId);

    const text = await getBotMessage('withdraw_approved', { amount: String(amount) });
    await ctx.telegram.sendMessage(playerTelegramId, text, {
      parse_mode: 'HTML',
      reply_markup: mainMenuMarkup,
    });

    await ctx.answerCbQuery('✅ Withdrawal approved');
  }
}

import {
  createTransaction,
  getAdminTelegramId,
  getBotMessage,
  getOrCreatePlayer,
  setPlayerAppId,
  updateTransactionMessageId,
} from '../db/supabase';
import { BotContext } from '../types';

// ── /withdraw command ─────────────────────────────────────────────────────────

export async function withdrawCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  try {
    ctx.session.step = 'waiting_withdraw_amount';
    ctx.session.withdrawAmount = undefined;

    const text = await getBotMessage('withdraw_prompt');
    await ctx.reply(
      `💸 <b>Withdrawal Request</b>\n\n${text}`,
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    console.error('[withdraw] command error:', err);
    await ctx.reply('An error occurred. Please try again.');
  }
}

// ── Step 1 — capture withdrawal amount ───────────────────────────────────────

export async function handleWithdrawAmount(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const raw = ctx.message.text.trim();
  const amount = parseFloat(raw);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Please enter a valid positive number for the amount.');
    return;
  }

  ctx.session.withdrawAmount = amount;
  ctx.session.step = 'waiting_withdraw_app_id';

  const text = await getBotMessage('withdraw_appid_prompt', { amount: String(amount) });
  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ── Step 2 — capture player app ID ───────────────────────────────────────────

export async function handleWithdrawAppId(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  const amount = ctx.session.withdrawAmount;

  if (!amount) {
    ctx.session.step = undefined;
    await ctx.reply('Something went wrong. Please start again with /withdraw.');
    return;
  }

  if (!playerAppId) {
    await ctx.reply('Player App ID cannot be empty. Please enter your Player App ID:');
    return;
  }

  try {
    const player = await getOrCreatePlayer(ctx.from.id, ctx.from.username ?? null);
    await setPlayerAppId(player.id, playerAppId);

    const transaction = await createTransaction(player.id, 'withdraw', amount);

    const adminId = await getAdminTelegramId();
    const playerTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    const adminMsg = await ctx.telegram.sendMessage(
      adminId,
      `<b>💸 New Withdrawal Request</b>\n\n` +
        `👤 Player: ${playerTag}\n` +
        `🆔 Telegram ID: ${ctx.from.id}\n` +
        `💵 Amount: <b>${amount}</b> chips\n` +
        `🎮 Player App ID: <code>${playerAppId}</code>\n\n` +
        `Transaction #${transaction.id}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_wd_${transaction.id}` },
              { text: '❌ Reject',  callback_data: `reject_wd_${transaction.id}` },
            ],
          ],
        },
      },
    );

    await updateTransactionMessageId(transaction.id, adminMsg.message_id);

    ctx.session.step = undefined;
    ctx.session.withdrawAmount = undefined;

    const text = await getBotMessage('withdraw_submitted');
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[withdraw] app ID handler error:', err);
    await ctx.reply('Failed to submit your withdrawal request. Please try again with /withdraw.');
    ctx.session.step = undefined;
    ctx.session.withdrawAmount = undefined;
  }
}

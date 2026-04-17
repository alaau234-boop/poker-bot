import { NarrowedContext, Context } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import {
  createTransaction,
  getActiveClubs,
  getAdminTelegramId,
  getBotMessage,
  getOrCreatePlayer,
  updateTransactionMessageId,
} from '../db/supabase';
import { BotContext } from '../types';

// ── /deposit command ──────────────────────────────────────────────────────────

export async function depositCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  try {
    const clubs = await getActiveClubs();

    if (clubs.length === 0) {
      await ctx.reply('No active clubs are available right now. Please try again later.');
      return;
    }

    ctx.session.step = 'waiting_deposit_amount';
    ctx.session.depositAmount = undefined;

    let msg = '<b>🏦 Bank Details</b>\n\n';
    for (const club of clubs) {
      msg +=
        `🎰 <b>${club.name}</b> (ID: <code>${club.club_id}</code>)\n` +
        `  Rate: ${club.chip_rate} chips per unit\n` +
        `  Bank: ${club.bank_name}\n` +
        `  Account: <code>${club.bank_account}</code>\n` +
        `  Holder: ${club.account_holder}\n\n`;
    }

    msg += await getBotMessage('deposit_prompt');

    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[deposit] command error:', err);
    await ctx.reply('An error occurred. Please try again.');
  }
}

// ── Step 1 — capture deposit amount ──────────────────────────────────────────

export async function handleDepositAmount(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const raw = ctx.message.text.trim();
  console.log('[handleDepositAmount] session.step:', ctx.session.step, '| incoming text:', raw);

  const amount = parseFloat(raw);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Please enter a valid positive number for the amount.');
    return;
  }

  ctx.session.depositAmount = amount;
  ctx.session.step = 'waiting_receipt';

  const text = await getBotMessage('deposit_receipt_prompt', { amount: String(amount) });
  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ── Step 2 — capture receipt photo ───────────────────────────────────────────

export async function handleReceiptPhoto(
  ctx: NarrowedContext<BotContext, Update.MessageUpdate<Message.PhotoMessage>>,
): Promise<void> {
  if (!ctx.from) return;

  const amount = ctx.session.depositAmount;
  if (amount === undefined) {
    ctx.session.step = undefined;
    ctx.session.depositAmount = undefined;
    await ctx.reply('Something went wrong. Please start again with /deposit.');
    return;
  }

  try {
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;

    const player = await getOrCreatePlayer(ctx.from.id, ctx.from.username ?? null);
    const transaction = await createTransaction(player.id, 'deposit', amount, fileId);

    const adminId = await getAdminTelegramId();
    const playerTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    const adminMsg = await ctx.telegram.sendPhoto(adminId, fileId, {
      caption:
        `<b>💰 New Deposit Request</b>\n\n` +
        `👤 Player: ${playerTag}\n` +
        `🆔 Telegram ID: ${ctx.from.id}\n` +
        `💵 Amount: <b>${amount}</b> chips\n\n` +
        `Transaction #${transaction.id}`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve_dep_${transaction.id}` },
            { text: '❌ Reject',  callback_data: `reject_dep_${transaction.id}` },
          ],
        ],
      },
    });

    await updateTransactionMessageId(transaction.id, adminMsg.message_id);

    ctx.session.step = undefined;
    ctx.session.depositAmount = undefined;

    const text = await getBotMessage('deposit_submitted');
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[deposit] receipt handler error:', err);
    await ctx.reply('Failed to process your receipt. Please try again with /deposit.');
    ctx.session.step = undefined;
    ctx.session.depositAmount = undefined;
  }
}

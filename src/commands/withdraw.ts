import {
  createTransaction,
  getBotMessage,
  getOrCreatePlayerByAppId,
  updateTransactionMessageId,
} from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

// ── Button callback ───────────────────────────────────────────────────────────

export async function handleWithdrawButton(ctx: BotContext): Promise<void> {
  try {
    const text = await getBotMessage('withdraw_instructions');
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Main Menu', callback_data: 'main_menu' },
          { text: 'Proceed',   callback_data: 'proceed_withdraw' },
        ]],
      },
    });
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[withdraw_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Proceed callback ──────────────────────────────────────────────────────────

export async function handleProceedWithdraw(ctx: BotContext): Promise<void> {
  try {
    ctx.session.step = 'waiting_withdraw_amount';

    const text = await getBotMessage('withdraw_amount_prompt');
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[proceed_withdraw]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Step 1 — withdrawal amount ────────────────────────────────────────────────

export async function handleWithdrawAmount(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const amount = parseFloat(ctx.message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Please enter a valid positive number.');
    return;
  }

  ctx.session.withdrawAmount = amount;
  ctx.session.step = 'waiting_withdraw_player_id';

  const text = await getBotMessage('withdraw_playerid_prompt');
  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ── Step 2 — player ID ────────────────────────────────────────────────────────

export async function handleWithdrawPlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  if (!playerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  ctx.session.withdrawPlayerId = playerAppId;
  ctx.session.step = 'waiting_withdraw_bank_account';

  const text = await getBotMessage('withdraw_bankaccount_prompt');
  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ── Step 3 — bank account → create transaction ────────────────────────────────

export async function handleWithdrawBankAccount(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const bankAccount = ctx.message.text.trim();
  if (!bankAccount) {
    await ctx.reply('Bank account number cannot be empty. Please try again.');
    return;
  }

  const amount      = ctx.session.withdrawAmount;
  const playerAppId = ctx.session.withdrawPlayerId;

  if (!amount || !playerAppId) {
    ctx.session.step = undefined;
    await ctx.reply('Something went wrong. Please start again with /start.');
    return;
  }

  try {
    const player      = await getOrCreatePlayerByAppId(playerAppId, ctx.from.id);
    const transaction = await createTransaction(player.id, 'withdraw', amount, undefined, bankAccount);

    const groupId = parseInt(process.env.GROUP_ID!);
    const adminMsg = await ctx.telegram.sendMessage(
      groupId,
      `<b>New Withdrawal Request</b>\n\n` +
      `Player ID: <code>${playerAppId}</code>\n` +
      `Amount: <b>${amount}</b> chips\n` +
      `Bank Account: <code>${bankAccount}</code>\n\n` +
      `Transaction #${transaction.id}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve_wd_${transaction.id}` },
            { text: '❌ Reject',  callback_data: `reject_wd_${transaction.id}` },
          ]],
        },
      },
    );

    await updateTransactionMessageId(transaction.id, adminMsg.message_id);

    // Clear session
    ctx.session.step           = undefined;
    ctx.session.withdrawAmount  = undefined;
    ctx.session.withdrawPlayerId = undefined;

    const confirmation = await getBotMessage('withdraw_submitted');
    await ctx.reply(confirmation, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
  } catch (err) {
    console.error('[withdraw_bank_account]', err);
    await ctx.reply('Failed to submit your withdrawal. Please start again with /start.');
    ctx.session.step = undefined;
  }
}

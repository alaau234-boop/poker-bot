import { NarrowedContext } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import {
  createTransaction,
  getActiveClubs,
  getBotMessage,
  getOrCreatePlayerByAppId,
  updateTransactionMessageId,
} from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBankDetailsText(clubs: Awaited<ReturnType<typeof getActiveClubs>>): string {
  return clubs
    .map(
      (c) =>
        `Bank: ${c.bank_name}\n` +
        `Name: ${c.account_holder}\n` +
        `A/C No: <code>${c.bank_account}</code>`,
    )
    .join('\n\n');
}

// ── Button callback ───────────────────────────────────────────────────────────

export async function handleDepositButton(ctx: BotContext): Promise<void> {
  try {
    const [clubs, instructions] = await Promise.all([
      getActiveClubs(),
      getBotMessage('deposit_instructions'),
    ]);

    const bankDetails = buildBankDetailsText(clubs);
    const text = `${instructions}\n\n${bankDetails}`;

    ctx.session.step = 'waiting_deposit_receipt';

    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
    await ctx.answerCbQuery();
    await ctx.reply('👇 type below.');
  } catch (err) {
    console.error('[deposit_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Step 1 — receipt photo or document ───────────────────────────────────────

async function processReceipt(ctx: BotContext, fileId: string, isDocument: boolean): Promise<void> {
  ctx.session.depositReceiptFileId    = fileId;
  ctx.session.depositReceiptIsDocument = isDocument;
  ctx.session.step = 'waiting_deposit_amount';

  const text = await getBotMessage('deposit_amount_prompt');
  await ctx.reply(text, { parse_mode: 'HTML' });
  await ctx.reply('👇 type below.');
}

export async function handleDepositPhoto(
  ctx: NarrowedContext<BotContext, Update.MessageUpdate<Message.PhotoMessage>>,
): Promise<void> {
  const photos = ctx.message.photo;
  await processReceipt(ctx as BotContext, photos[photos.length - 1].file_id, false);
}

export async function handleDepositDocument(
  ctx: NarrowedContext<BotContext, Update.MessageUpdate<Message.DocumentMessage>>,
): Promise<void> {
  await processReceipt(ctx as BotContext, ctx.message.document.file_id, true);
}

// ── Step 2 — deposit amount ───────────────────────────────────────────────────

export async function handleDepositAmount(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const amount = parseFloat(ctx.message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Please enter a valid positive number.');
    return;
  }

  ctx.session.depositAmount = amount;
  ctx.session.step = 'waiting_deposit_player_id';

  const text = await getBotMessage('deposit_playerid_prompt');
  await ctx.reply(text, { parse_mode: 'HTML' });
  await ctx.reply('👇 type below.');
}

// ── Step 3 — player ID → create transaction ───────────────────────────────────

export async function handleDepositPlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  if (!playerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  const receiptFileId = ctx.session.depositReceiptFileId;
  const isDocument   = ctx.session.depositReceiptIsDocument ?? false;
  const amount       = ctx.session.depositAmount;

  if (!receiptFileId || amount === undefined) {
    ctx.session.step = undefined;
    await ctx.reply('Something went wrong. Please start again with /start.');
    return;
  }

  try {
    const player      = await getOrCreatePlayerByAppId(playerAppId, ctx.from.id);
    const transaction = await createTransaction(player.id, 'deposit', amount, receiptFileId);

    const groupId = parseInt(process.env.GROUP_ID!);
    const caption =
      `<b>New Deposit Request</b>\n\n` +
      `Player ID: <code>${playerAppId}</code>\n` +
      `Amount: <b>${amount}</b> chips\n\n` +
      `Transaction #${transaction.id}`;

    const markup = {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve_dep_${transaction.id}` },
        { text: '❌ Reject',  callback_data: `reject_dep_${transaction.id}` },
      ]],
    };

    let adminMsg;
    if (isDocument) {
      adminMsg = await ctx.telegram.sendDocument(groupId, receiptFileId, {
        caption, parse_mode: 'HTML', reply_markup: markup,
      });
    } else {
      adminMsg = await ctx.telegram.sendPhoto(groupId, receiptFileId, {
        caption, parse_mode: 'HTML', reply_markup: markup,
      });
    }

    await updateTransactionMessageId(transaction.id, adminMsg.message_id);

    // Clear session
    ctx.session.step                    = undefined;
    ctx.session.depositReceiptFileId    = undefined;
    ctx.session.depositReceiptIsDocument = undefined;
    ctx.session.depositAmount           = undefined;

    const confirmation = await getBotMessage('deposit_submitted');
    await ctx.reply(confirmation, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
  } catch (err) {
    console.error('[deposit_player_id]', err);
    await ctx.reply('Failed to process your deposit. Please start again with /start.');
    ctx.session.step = undefined;
  }
}

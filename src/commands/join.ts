import {
  createJoinRequest,
  getActiveClubs,
  getBotMessage,
  getPlayerByTelegramId,
  updateJoinRequestMessageId,
} from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

// ── Button callback ───────────────────────────────────────────────────────────

export async function handleJoinButton(ctx: BotContext): Promise<void> {
  try {
    if (!ctx.from) return;

    // If already registered, show their Player ID and stop
    const player = await getPlayerByTelegramId(ctx.from.id);
    if (player?.player_app_id) {
      const text = await getBotMessage('already_registered', { player_id: player.player_app_id });
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
      await ctx.answerCbQuery();
      return;
    }

    const [clubs, text] = await Promise.all([
      getActiveClubs(),
      getBotMessage('join_instructions'),
    ]);

    const clubLine = clubs.length > 0
      ? `\n\nClub ID: <code>${clubs[0].club_id}</code>`
      : '';

    ctx.session.step = 'waiting_join_player_id';

    await ctx.editMessageText(`${text}${clubLine}`, {
      parse_mode: 'HTML',
      reply_markup: mainMenuMarkup,
    });
    await ctx.answerCbQuery();
    await ctx.reply('👇 type below.');
  } catch (err) {
    console.error('[join_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Step 1 — player ID → submit for admin approval ────────────────────────────

export async function handleJoinPlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  if (!playerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  ctx.session.step = undefined;

  try {
    const request = await createJoinRequest(ctx.from.id, playerAppId);

    const groupId = parseInt(process.env.GROUP_ID!);
    const adminMsg = await ctx.telegram.sendMessage(
      groupId,
      `<b>New Player ID Registration</b>\n\n` +
      `Telegram ID: <code>${ctx.from.id}</code>\n` +
      `Player ID: <code>${playerAppId}</code>\n\n` +
      `Request #${request.id}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve_join_${request.id}` },
            { text: '❌ Reject',  callback_data: `reject_join_${request.id}` },
          ]],
        },
      },
    );

    await updateJoinRequestMessageId(request.id, adminMsg.message_id);

    const text = await getBotMessage('join_submitted');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
  } catch (err) {
    console.error('[join_player_id]', err);
    await ctx.reply('Failed to submit your request. Please try again with /start.');
  }
}

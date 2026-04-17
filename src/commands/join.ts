import { getActiveClubs, getBotMessage } from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

// ── Button callback ───────────────────────────────────────────────────────────

export async function handleJoinButton(ctx: BotContext): Promise<void> {
  try {
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

// ── Step 1 — player ID ────────────────────────────────────────────────────────

export async function handleJoinPlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  if (!playerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  ctx.session.step = undefined;

  const text = await getBotMessage('join_confirmed');
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
}

import { getBotMessage, getPlayerByAppId } from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

// ── Button callback ───────────────────────────────────────────────────────────

export async function handleBalanceButton(ctx: BotContext): Promise<void> {
  try {
    ctx.session.step = 'waiting_join_player_id';

    const text = await getBotMessage('balance_playerid_prompt');
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[balance_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Step 1 — player ID lookup ─────────────────────────────────────────────────

export async function handleBalancePlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const playerAppId = ctx.message.text.trim();
  if (!playerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  ctx.session.step = undefined;

  try {
    const player = await getPlayerByAppId(playerAppId);

    if (!player) {
      const text = await getBotMessage('no_account_message');
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
      return;
    }

    const text = await getBotMessage('balance_message', {
      player_id: playerAppId,
      balance:   player.balance.toFixed(2),
    });
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
  } catch (err) {
    console.error('[balance_player_id]', err);
    await ctx.reply('Failed to fetch balance. Please try again.');
  }
}

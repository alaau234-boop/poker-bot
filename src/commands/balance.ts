import { getBotMessage, getPlayerByTelegramId } from '../db/supabase';
import { BotContext } from '../types';

export async function balanceCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  try {
    const player = await getPlayerByTelegramId(ctx.from.id);

    if (!player) {
      const text = await getBotMessage('no_account_message');
      await ctx.reply(text, { parse_mode: 'HTML' });
      return;
    }

    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const text = await getBotMessage('balance_message', {
      username,
      balance: player.balance.toFixed(2),
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[balance] error:', err);
    await ctx.reply('Failed to fetch your balance. Please try again.');
  }
}

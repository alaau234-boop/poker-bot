import { getActiveClubs } from '../db/supabase';
import { BotContext } from '../types';

export async function clubsCommand(ctx: BotContext): Promise<void> {
  try {
    const clubs = await getActiveClubs();

    if (clubs.length === 0) {
      await ctx.reply('No active clubs at the moment. Please check back later.');
      return;
    }

    const lines = clubs.map(
      (c) =>
        `🎰 <b>${c.name}</b>\n` +
        `  Club ID: <code>${c.club_id}</code>\n` +
        `  Chip Rate: ${c.chip_rate} chips per unit`,
    );

    await ctx.reply(
      `🃏 <b>Active Clubs</b>\n\n${lines.join('\n\n')}`,
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    console.error('[clubs] error:', err);
    await ctx.reply('Failed to fetch clubs. Please try again.');
  }
}

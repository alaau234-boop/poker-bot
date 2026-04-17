import { getActiveClubs } from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

export async function handleClubsButton(ctx: BotContext): Promise<void> {
  try {
    const clubs = await getActiveClubs();

    if (clubs.length === 0) {
      await ctx.editMessageText('No active clubs at the moment.', { reply_markup: mainMenuMarkup });
      await ctx.answerCbQuery();
      return;
    }

    const lines = clubs.map(
      (c) =>
        `<b>${c.name}</b>\n` +
        `Club ID: <code>${c.club_id}</code>\n` +
        `Rate: ${c.chip_rate} chips per MVR`,
    );

    await ctx.editMessageText(
      `<b>Active Clubs</b>\n\n${lines.join('\n\n')}`,
      { parse_mode: 'HTML', reply_markup: mainMenuMarkup },
    );
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[clubs_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

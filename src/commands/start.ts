import { getActiveClubs, getBotMessage } from '../db/supabase';
import { BotContext } from '../types';
import { Club } from '../types';

export function buildStartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Deposit',                  callback_data: 'deposit_btn' }],
      [{ text: 'Withdraw',                 callback_data: 'withdraw_btn' }],
      [{ text: 'Request ID / Join Club',   callback_data: 'join_btn' }],
      [{ text: 'Our Clubs',                callback_data: 'clubs_btn' }],
    ],
  };
}

function buildClubsText(clubs: Club[]): string {
  if (clubs.length === 0) return 'No active clubs at the moment.';
  return clubs
    .map(
      (c) =>
        `🎰 <b>${c.name}</b>\n` +
        `Club ID: <code>${c.club_id}</code>\n` +
        `Rate: ${c.chip_rate} chips per unit`,
    )
    .join('\n\n');
}

async function buildStartText(clubs: Club[]): Promise<string> {
  const welcome = await getBotMessage('start_welcome');
  return `${buildClubsText(clubs)}\n\n${welcome}`;
}

export async function startCommand(ctx: BotContext): Promise<void> {
  try {
    const clubs = await getActiveClubs();
    const text  = await buildStartText(clubs);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: buildStartKeyboard() });
  } catch (err) {
    console.error('[start]', err);
    await ctx.reply('Something went wrong. Please try again.');
  }
}

export async function handleMainMenu(ctx: BotContext): Promise<void> {
  try {
    const clubs = await getActiveClubs();
    const text  = await buildStartText(clubs);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: buildStartKeyboard() });
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('[main_menu]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

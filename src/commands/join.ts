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

    const player = await getPlayerByTelegramId(ctx.from.id);

    if (player?.player_app_id) {
      // Already registered — offer to change Player ID
      const text = await getBotMessage('already_registered_change', {
        player_id: player.player_app_id,
      });
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Yes, Change',  callback_data: 'change_player_id_btn' },
            { text: 'Main Menu',   callback_data: 'main_menu' },
          ]],
        },
      });
      await ctx.answerCbQuery();
      return;
    }

    // Not yet registered — start registration flow
    await showJoinInstructions(ctx);
  } catch (err) {
    console.error('[join_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── "Yes, Change" callback ────────────────────────────────────────────────────

export async function handleChangePlayerIdButton(ctx: BotContext): Promise<void> {
  try {
    await showJoinInstructions(ctx, true);
  } catch (err) {
    console.error('[change_player_id_btn]', err);
    await ctx.answerCbQuery('Something went wrong.');
  }
}

// ── Shared: show join instructions ────────────────────────────────────────────

async function showJoinInstructions(ctx: BotContext, isChange = false): Promise<void> {
  const [clubs, instructions, prompt] = await Promise.all([
    getActiveClubs(),
    getBotMessage('join_instructions'),
    getBotMessage(isChange ? 'change_playerid_prompt' : 'join_playerid_prompt'),
  ]);

  const clubLine = clubs.length > 0
    ? `\n\nClub ID: <code>${clubs[0].club_id}</code>`
    : '';

  ctx.session.step = isChange ? 'waiting_change_player_id' : 'waiting_join_player_id';

  await ctx.editMessageText(`${instructions}${clubLine}`, {
    parse_mode: 'HTML',
    reply_markup: mainMenuMarkup,
  });
  await ctx.answerCbQuery();
  await ctx.reply(prompt, { parse_mode: 'HTML' });
  await ctx.reply('👇 type below.');
}

// ── Step: new registration Player ID ─────────────────────────────────────────

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

// ── Step: change Player ID ────────────────────────────────────────────────────

export async function handleChangePlayerId(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

  const newPlayerAppId = ctx.message.text.trim();
  if (!newPlayerAppId) {
    await ctx.reply('Player ID cannot be empty. Please try again.');
    return;
  }

  ctx.session.step = undefined;

  try {
    const player = await getPlayerByTelegramId(ctx.from.id);
    const oldPlayerAppId = player?.player_app_id ?? '';

    const request = await createJoinRequest(ctx.from.id, newPlayerAppId, oldPlayerAppId);

    const groupId = parseInt(process.env.GROUP_ID!);
    const adminMsg = await ctx.telegram.sendMessage(
      groupId,
      `<b>Player ID Change Request</b>\n\n` +
      `Current Player ID: <code>${oldPlayerAppId}</code>\n` +
      `New Player ID: <code>${newPlayerAppId}</code>\n\n` +
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

    const text = await getBotMessage('change_submitted');
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuMarkup });
  } catch (err) {
    console.error('[change_player_id]', err);
    await ctx.reply('Failed to submit your request. Please try again with /start.');
  }
}

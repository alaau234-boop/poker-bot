import {
  approveJoinRequest,
  getBotMessage,
  getJoinRequestById,
  isAdmin,
  rejectJoinRequest,
} from '../db/supabase';
import { BotContext } from '../types';
import { mainMenuMarkup } from '../keyboards';

/**
 * Handles ✅ / ❌ inline button presses for Player ID registration requests.
 *
 * Callback data format:  <action>_join_<requestId>
 *   action    : "approve" | "reject"
 *   requestId : numeric join_request ID
 */
export async function handleJoinApproval(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    await ctx.answerCbQuery('⛔ Unauthorized');
    return;
  }

  const data  = ctx.callbackQuery.data;
  const match = data.match(/^(approve|reject)_join_(\d+)$/);
  if (!match) {
    await ctx.answerCbQuery('Invalid callback data');
    return;
  }

  const action    = match[1] as 'approve' | 'reject';
  const requestId = parseInt(match[2]);

  try {
    const request = await getJoinRequestById(requestId);
    if (!request) {
      await ctx.answerCbQuery('Request not found');
      return;
    }

    if (request.status !== 'pending') {
      await ctx.answerCbQuery(`Already ${request.status}`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
      return;
    }

    if (action === 'approve') {
      await approveJoinRequest(requestId, ctx.from.id, request.telegram_id, request.player_app_id);

      const text = await getBotMessage('join_approved');
      await ctx.telegram.sendMessage(request.telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: mainMenuMarkup,
      });

      await ctx.answerCbQuery('✅ Player ID approved');
    } else {
      await rejectJoinRequest(requestId, ctx.from.id);

      const text = await getBotMessage('join_rejected');
      await ctx.telegram.sendMessage(request.telegram_id, text, {
        parse_mode: 'HTML',
        reply_markup: mainMenuMarkup,
      });

      await ctx.answerCbQuery('❌ Request rejected');
    }

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => null);
  } catch (err) {
    console.error('[joinApproval] error:', err);
    await ctx.answerCbQuery('An error occurred. Check bot logs.');
  }
}

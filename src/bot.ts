import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import { message } from 'telegraf/filters';
import express from 'express';

import { BotContext, SessionData } from './types';
import { depositCommand, handleDepositAmount, handleReceiptPhoto } from './commands/deposit';
import { withdrawCommand, handleWithdrawAmount, handleWithdrawAppId } from './commands/withdraw';
import { balanceCommand } from './commands/balance';
import { clubsCommand } from './commands/clubs';
import { handleAdminApproval } from './handlers/adminApproval';

// ── Environment validation ────────────────────────────────────────────────────

const {
  BOT_TOKEN,
  GROUP_ID,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PUBLIC_DOMAIN,
  PORT: PORT_ENV,
} = process.env;

const missing = (
  ['BOT_TOKEN', 'GROUP_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const
).filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = parseInt(PORT_ENV ?? '3000', 10);

// ── Bot setup ─────────────────────────────────────────────────────────────────

const bot = new Telegraf<BotContext>(BOT_TOKEN!);

// Session middleware — keyed by chatId:userId by default
bot.use(
  session<SessionData, BotContext>({
    defaultSession: (): SessionData => ({}),
  }),
);

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command('deposit', depositCommand);
bot.command('withdraw', withdrawCommand);
bot.command('balance', balanceCommand);
bot.command('clubs', clubsCommand);

// ── Message handlers (session-driven flows) ───────────────────────────────────

// Photo → deposit receipt capture
bot.on(message('photo'), async (ctx) => {
  if (ctx.session.step !== 'waiting_receipt') return;
  await handleReceiptPhoto(ctx);
});

// Text → deposit / withdraw conversational steps
bot.on(message('text'), async (ctx) => {
  switch (ctx.session.step) {
    case 'waiting_deposit_amount':
      await handleDepositAmount(ctx);
      break;
    case 'waiting_withdraw_amount':
      await handleWithdrawAmount(ctx);
      break;
    case 'waiting_withdraw_app_id':
      await handleWithdrawAppId(ctx);
      break;
    // No session step — ignore plain text
  }
});

// ── Callback queries (admin approve / reject buttons) ─────────────────────────

bot.on('callback_query', handleAdminApproval);

// ── Error handler ─────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Unhandled error for update ${ctx.update.update_id}:`, err);
});

// ── Launch ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (PUBLIC_DOMAIN) {
      // ── Webhook mode (production on Railway / any host) ───────────────────
      // Include the bot token in the path as a simple secret to prevent
      // unauthorized webhook requests from reaching the bot.
      const webhookPath = `/webhook/${BOT_TOKEN}`;
      const webhookUrl = `https://${PUBLIC_DOMAIN}${webhookPath}`;

      const app = express();
      app.use(express.json());

      // Telegram updates land here
      app.use(bot.webhookCallback(webhookPath));

      // Health check endpoint
      app.get('/', (_req, res) => {
        res.json({ status: 'ok', service: 'poker-chip-bot' });
      });

      await bot.telegram.setWebhook(webhookUrl);
      console.log(`Webhook set → ${webhookUrl}`);

      app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
      });
    } else {
      // ── Long-polling mode (local development) ────────────────────────────
      console.log('PUBLIC_DOMAIN not set — starting in polling mode');
      // Delete any existing webhook so polling works cleanly
      await bot.telegram.deleteWebhook();
      await bot.launch();
      console.log('Bot started in polling mode');
    }
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

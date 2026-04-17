import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import { message } from 'telegraf/filters';
import express from 'express';

import { BotContext, SessionData } from './types';
import { startCommand, handleMainMenu }       from './commands/start';
import {
  handleDepositButton,
  handleDepositPhoto,
  handleDepositDocument,
  handleDepositAmount,
  handleDepositPlayerId,
} from './commands/deposit';
import {
  handleWithdrawButton,
  handleProceedWithdraw,
  handleWithdrawAmount,
  handleWithdrawPlayerId,
  handleWithdrawBankAccount,
} from './commands/withdraw';
import { handleJoinButton, handleJoinPlayerId } from './commands/join';
import { handleClubsButton }    from './commands/clubs';
import { handleAdminApproval }  from './handlers/adminApproval';
import { handleJoinApproval }   from './handlers/joinApproval';

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

bot.use(
  session<SessionData, BotContext>({
    defaultSession: (): SessionData => ({}),
  }),
);

// ── Commands ──────────────────────────────────────────────────────────────────

bot.command('start', startCommand);

// ── Inline keyboard actions (user-facing) ────────────────────────────────────

bot.action('main_menu',        handleMainMenu);
bot.action('deposit_btn',      handleDepositButton);
bot.action('withdraw_btn',     handleWithdrawButton);
bot.action('proceed_withdraw', handleProceedWithdraw);
bot.action('join_btn',         handleJoinButton);
bot.action('clubs_btn',        handleClubsButton);

// ── Inline keyboard actions (admin approve / reject) ─────────────────────────

bot.action(/^(approve|reject)_(dep|wd)_\d+$/, handleAdminApproval);
bot.action(/^(approve|reject)_join_\d+$/,      handleJoinApproval);

// ── Message handlers (session-driven flows) ───────────────────────────────────

bot.on(message('photo'), async (ctx) => {
  if (ctx.session.step === 'waiting_deposit_receipt') await handleDepositPhoto(ctx);
});

bot.on(message('document'), async (ctx) => {
  if (ctx.session.step === 'waiting_deposit_receipt') await handleDepositDocument(ctx);
});

bot.on(message('text'), async (ctx) => {
  switch (ctx.session.step) {
    case 'waiting_deposit_amount':       await handleDepositAmount(ctx);       break;
    case 'waiting_deposit_player_id':    await handleDepositPlayerId(ctx);     break;
    case 'waiting_withdraw_amount':      await handleWithdrawAmount(ctx);      break;
    case 'waiting_withdraw_player_id':   await handleWithdrawPlayerId(ctx);    break;
    case 'waiting_withdraw_bank_account':await handleWithdrawBankAccount(ctx); break;
    case 'waiting_join_player_id':       await handleJoinPlayerId(ctx);        break;
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`Unhandled error for update ${ctx.update.update_id}:`, err);
});

// ── Launch ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (PUBLIC_DOMAIN) {
      // ── Webhook mode (production) ─────────────────────────────────────────
      const webhookPath = `/webhook/${BOT_TOKEN}`;
      const webhookUrl  = `https://${PUBLIC_DOMAIN}${webhookPath}`;

      const app = express();
      app.use(express.json());
      app.use(bot.webhookCallback(webhookPath));
      app.get('/', (_req, res) => res.json({ status: 'ok' }));

      // Server must be listening before Telegram sends the first update.
      await new Promise<void>((resolve) => {
        app.listen(PORT, () => {
          console.log(`Server listening on port ${PORT}`);
          resolve();
        });
      });

      console.log(`Registering webhook → ${webhookUrl}`);
      const ok   = await bot.telegram.setWebhook(webhookUrl);
      console.log(`setWebhook result: ${ok}`);

      const info = await bot.telegram.getWebhookInfo();
      console.log(`Webhook URL on Telegram: ${info.url}`);
      console.log(`Pending updates: ${info.pending_update_count}`);
    } else {
      // ── Long-polling mode (local development) ─────────────────────────────
      console.log('PUBLIC_DOMAIN not set — starting in polling mode');
      await bot.telegram.deleteWebhook();
      await bot.launch();
      console.log('Bot started in polling mode');
    }
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
})();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

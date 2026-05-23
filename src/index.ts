import { config } from './config';
import { bot, registerWebhook } from './integrations';
import { authMiddleware } from './bot/middleware/auth';
import { photoHandler } from './bot/handlers/photo';
import { registerCommandHandlers } from './bot/handlers/command';

bot.use(authMiddleware);

bot.command('ping', (ctx) => ctx.reply('pong 🏓'));

bot.command('start', (ctx) =>
  ctx.reply(
    '👋 *PapiPap* — your kitchen assistant is running\\!\n\n' +
      '📸 Send a cookbook photo to scan a recipe\n' +
      '📋 /recipes — view saved recipes\n' +
      '🗓 /plan — meal plan _\\(coming soon\\)_\n' +
      '🛒 /groceries — shopping list _\\(coming soon\\)_\n' +
      '📦 /pantry — pantry stock _\\(coming soon\\)_',
    { parse_mode: 'MarkdownV2' },
  ),
);

registerCommandHandlers(bot);
bot.on('photo', photoHandler);

async function start(): Promise<void> {
  console.info('[bot] Starting up…');
  console.info(
    `[bot] Mode: ${config.app.isProduction ? 'production (webhook)' : 'development (long-polling)'}`,
  );
  console.info(`[bot] Whitelisted user IDs: ${config.telegram.allowedUserIds.join(', ')}`);

  if (config.app.isProduction && config.telegram.webhookUrl) {
    await registerWebhook(config.telegram.webhookUrl);
    console.info('[bot] Running in webhook mode');
  } else {
    await bot.launch();
    console.info('[bot] Running in long-polling mode (development)');
    console.info('[bot] Send /ping to your bot in Telegram to verify the connection');
  }
}

start().catch((err: unknown) => {
  console.error('[bot] Failed to start:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

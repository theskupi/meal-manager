import { config } from './config';
import { bot, registerWebhook } from './integrations';
import { authMiddleware } from './bot/middleware/auth';
import { rateLimitMiddleware } from './bot/middleware/rate-limit';
import { photoHandler } from './bot/handlers/photo';
import { registerCommandHandlers } from './bot/handlers/command';
import { queryHandler } from './bot/handlers/query';
import { runDailyChecks } from './services/notifier';

bot.use(authMiddleware);
bot.use(rateLimitMiddleware);

bot.command('ping', (ctx) => ctx.reply('pong 🏓'));

registerCommandHandlers(bot);
bot.on('photo', photoHandler);
bot.on('text', queryHandler);

async function start(): Promise<void> {
  console.info('[bot] Starting up…');
  console.info(
    `[bot] Mode: ${config.app.isProduction ? 'production (webhook)' : 'development (long-polling)'}`,
  );

  if (config.app.isProduction && config.telegram.webhookUrl) {
    await registerWebhook(config.telegram.webhookUrl);
    console.info('[bot] Running in webhook mode');
  } else {
    await bot.launch();
    console.info('[bot] Running in long-polling mode (development)');
    console.info('[bot] Send /ping to your bot in Telegram to verify the connection');
  }

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    void runDailyChecks();
  }, SIX_HOURS_MS);
  console.info('[bot] Daily checks scheduled every 6 hours');
}

start().catch((err: unknown) => {
  console.error('[bot] Failed to start:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

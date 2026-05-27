import { Telegraf } from 'telegraf';
import { config } from '../config';

export const bot = new Telegraf(config.telegram.botToken);

export async function registerWebhook(webhookUrl: string): Promise<void> {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  await bot.launch({
    webhook: {
      domain: webhookUrl,
      path: '/bot',
      port,
    },
  });
  console.info(`[telegram] Webhook registered at ${webhookUrl}/bot, listening on port ${port}`);
}

import { Telegraf } from 'telegraf';
import { config } from '../config';

export const bot = new Telegraf(config.telegram.botToken);

export async function registerWebhook(webhookUrl: string): Promise<void> {
  await bot.telegram.setWebhook(`${webhookUrl}/bot`);
  console.info(`[telegram] Webhook registered at ${webhookUrl}/bot`);
}

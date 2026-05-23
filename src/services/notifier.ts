import { config } from '../config';
import { bot } from '../integrations/telegram';
import { PantryItem } from '../models/pantry-item';
import { checkExpiry } from './pantry';

export async function sendMessage(text: string): Promise<void> {
  for (const userId of config.telegram.allowedUserIds) {
    try {
      await bot.telegram.sendMessage(userId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`[notifier] Failed to send message to user ${userId}:`, err);
    }
  }
}

export async function sendExpiryWarning(
  item: PantryItem,
  suggestionTitle: string,
): Promise<void> {
  const date = item.expiryDate
    ? new Date(item.expiryDate + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      })
    : 'soon';
  await sendMessage(`⚠️ *${item.name}* expires on ${date}. Try: ${suggestionTitle}.`);
}

export async function sendRestockAlert(item: PantryItem): Promise<void> {
  await sendMessage(`🛒 Low stock: *${item.name}* (${item.quantity}${item.unit} remaining).`);
}

export async function runDailyChecks(): Promise<void> {
  try {
    const expiringItems = await checkExpiry();
    for (const item of expiringItems) {
      await sendExpiryWarning(item, 'a suitable recipe');
    }
    console.info(`[notifier] Daily checks complete — ${expiringItems.length} expiry warnings sent`);
  } catch (err) {
    console.error('[notifier] runDailyChecks failed:', err);
  }
}

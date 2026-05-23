import { Context } from 'telegraf';
import { parseIntent } from '../../integrations/groq';
import { upsertItem, listItems, checkExpiry } from '../../services/pantry';
import { PantryItemInputSchema } from '../../models/pantry-item';
import { IngredientUnitSchema } from '../../models/recipe';

export async function queryHandler(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;
  const text = ctx.message.text;

  if (text.startsWith('/')) return;

  let parsed: Awaited<ReturnType<typeof parseIntent>>;
  try {
    parsed = await parseIntent(text);
  } catch (err) {
    console.error('[query-handler] Intent parsing failed:', err);
    await ctx.reply('Sorry, I had trouble understanding that. Type /help to see what I can do.');
    return;
  }

  switch (parsed.intent) {
    case 'add_pantry': {
      const p = parsed.params as Record<string, unknown>;
      const nameRaw = p['name'] ?? p['item'] ?? p['ingredient'];
      const quantityRaw = p['quantity'] ?? p['amount'] ?? p['qty'];
      const unitRaw = p['unit'] ?? p['units'];
      const expiryRaw = p['expiryDate'] ?? p['expiry'] ?? p['expiry_date'];

      const unitResult = IngredientUnitSchema.safeParse(unitRaw);
      const inputResult = PantryItemInputSchema.safeParse({
        name: nameRaw,
        quantity: Number(quantityRaw ?? 0),
        unit: unitResult.success ? unitResult.data : 'other',
        expiryDate: typeof expiryRaw === 'string' ? expiryRaw : undefined,
      });

      if (!inputResult.success) {
        await ctx.reply(
          "❌ I couldn't parse the pantry item from that. Try: \"Added 500g chicken breast\" or use /addpantry.",
        );
        return;
      }

      try {
        const item = await upsertItem(inputResult.data);
        const expiry = item.expiryDate
          ? ` (expires ${new Date(item.expiryDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`
          : '';
        await ctx.reply(`✅ Added ${item.quantity}${item.unit} ${item.name}${expiry}.`);
      } catch (err) {
        console.error('[query-handler] Error adding pantry item:', err);
        await ctx.reply('⚠️ Failed to update pantry. Please try again.');
      }
      break;
    }

    case 'query_pantry': {
      const p = parsed.params as Record<string, unknown>;
      const queryType = String(p['query_type'] ?? p['type'] ?? '').toLowerCase();
      const isExpiryQuery = queryType.includes('expir') || String(text).toLowerCase().includes('expir');

      try {
        if (isExpiryQuery) {
          const expiring = await checkExpiry();
          if (expiring.length === 0) {
            await ctx.reply('✅ No items expiring in the next 48 hours.');
          } else {
            const lines = expiring.map(
              (i) =>
                `• ${i.name}: ${i.quantity}${i.unit}${i.expiryDate ? ` (expires ${i.expiryDate})` : ''}`,
            );
            await ctx.reply(`⚠️ *Expiring soon:*\n\n${lines.join('\n')}`, {
              parse_mode: 'Markdown',
            });
          }
        } else {
          const items = await listItems();
          if (items.length === 0) {
            await ctx.reply('📭 Pantry is empty. Use /addpantry to add items.');
          } else {
            const lines = items
              .slice(0, 30)
              .map((i) => `• ${i.name}: ${i.quantity}${i.unit}`);
            const suffix = items.length > 30 ? `\n_…and ${items.length - 30} more_` : '';
            await ctx.reply(`📦 *Pantry stock:*\n\n${lines.join('\n')}${suffix}`, {
              parse_mode: 'Markdown',
            });
          }
        }
      } catch (err) {
        console.error('[query-handler] Error querying pantry:', err);
        await ctx.reply('⚠️ Failed to fetch pantry. Please try again.');
      }
      break;
    }

    case 'query_schedule':
    case 'skip_meal':
      await ctx.reply(
        '🗓 Meal schedule management is coming soon! For now, use /plan to view your schedule.',
      );
      break;

    default:
      await ctx.reply(
        "Sorry, I didn't understand that. Type /help to see what I can do.",
      );
  }
}

import { Context } from 'telegraf';
import { config } from '../../config';
import { parseIntent } from '../../integrations/groq';
import { upsertItem, listItems, checkExpiry, deleteItem } from '../../services/pantry';
import { getByDate, getWeekPlan, skipMeal, generateLunchPlan } from '../../services/meal-planner';
import { generate as generateGroceryList } from '../../services/grocery-list';
import { GroceryItem } from '../../models/grocery-list';
import { PantryItemInputSchema } from '../../models/pantry-item';
import { IngredientUnitSchema } from '../../models/recipe';
import { MealEntry, MealTypeSchema } from '../../models/meal-plan';

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] as string;
}

function resolveDate(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return todayIso();
  const lower = raw.toLowerCase().trim();
  if (lower === 'today') return todayIso();
  if (lower === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0] as string;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayIso();
}

function formatDateShort(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatMealLine(e: MealEntry): string {
  const type = e.mealType.charAt(0).toUpperCase() + e.mealType.slice(1);
  const suffix = e.status !== 'planned' ? ` — _${e.status}_` : '';
  return `• ${type}: ${e.recipeTitle} (${e.servings} servings)${suffix}`;
}

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
        console.warn(
          '[query-handler] add_pantry Zod validation failed. Groq params:',
          JSON.stringify(p),
          '| Errors:',
          inputResult.error.flatten(),
        );
        await ctx.reply(
          '❌ I couldn\'t parse the pantry item from that. Try: "Added 500g chicken breast" or use /addpantry.',
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

    case 'remove_pantry': {
      const p = parsed.params as Record<string, unknown>;
      const nameRaw = p['name'] ?? p['item'] ?? p['ingredient'];
      if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
        await ctx.reply(
          '❌ I couldn\'t work out which item to remove. Try: "Remove pasta from pantry" or use /removepantry.',
        );
        break;
      }

      try {
        const removed = await deleteItem(nameRaw.trim());
        if (removed) {
          await ctx.reply(`✅ Removed *${nameRaw.trim()}* from pantry.`, {
            parse_mode: 'Markdown',
          });
        } else {
          await ctx.reply(`❌ *${nameRaw.trim()}* not found in pantry.`, {
            parse_mode: 'Markdown',
          });
        }
      } catch (err) {
        console.error('[query-handler] Error removing pantry item:', err);
        await ctx.reply('⚠️ Failed to remove item. Please try again.');
      }
      break;
    }

    case 'query_pantry': {
      const p = parsed.params as Record<string, unknown>;
      const queryType = String(p['query_type'] ?? p['type'] ?? '').toLowerCase();
      const isExpiryQuery =
        queryType.includes('expir') || String(text).toLowerCase().includes('expir');

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
            const lines = items.slice(0, 30).map((i) => `• ${i.name}: ${i.quantity}${i.unit}`);
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

    case 'query_schedule': {
      const p = parsed.params as Record<string, unknown>;
      const rawDate = p['date'] ?? p['day'] ?? p['when'];
      const isWeekQuery =
        !rawDate ||
        String(text).toLowerCase().includes('week') ||
        String(text).toLowerCase().includes('plan');

      try {
        if (isWeekQuery) {
          const from = todayIso();
          const entries = await getWeekPlan(from, config.app.planHorizonDays);
          if (entries.length === 0) {
            await ctx.reply('🗓 No meals planned for the upcoming week.');
          } else {
            const grouped = entries.reduce<Record<string, MealEntry[]>>((acc, e) => {
              (acc[e.date] ??= []).push(e);
              return acc;
            }, {});
            const lines = Object.entries(grouped).map(([date, meals]) => {
              return `*${formatDateShort(date)}:*\n${meals.map(formatMealLine).join('\n')}`;
            });
            await ctx.reply(`🗓 *Upcoming meal plan:*\n\n${lines.join('\n\n')}`, {
              parse_mode: 'Markdown',
            });
          }
        } else {
          const date = resolveDate(rawDate);
          const entries = await getByDate(date);
          if (entries.length === 0) {
            await ctx.reply(`🗓 No meals planned for ${formatDateShort(date)}.`);
          } else {
            const lines = entries.map(formatMealLine);
            await ctx.reply(`🗓 *Meal plan for ${formatDateShort(date)}:*\n\n${lines.join('\n')}`, {
              parse_mode: 'Markdown',
            });
          }
        }
      } catch (err) {
        console.error('[query-handler] Error fetching schedule:', err);
        await ctx.reply('⚠️ Failed to fetch meal schedule. Please try again.');
      }
      break;
    }

    case 'skip_meal': {
      const p = parsed.params as Record<string, unknown>;
      const rawDate = p['date'] ?? p['day'] ?? p['when'];
      const mealTypeRaw = p['meal_type'] ?? p['type'] ?? p['meal'];

      const date = resolveDate(rawDate);
      const mealTypeResult = MealTypeSchema.safeParse(mealTypeRaw);

      if (!mealTypeResult.success) {
        await ctx.reply(
          '❌ Could not parse skip request. Try: "Skip lunch on Thursday" or use /skip <date> <type>.',
        );
        break;
      }

      try {
        await skipMeal(date, mealTypeResult.data);
        const type = mealTypeResult.data.charAt(0).toUpperCase() + mealTypeResult.data.slice(1);
        await ctx.reply(`✅ ${type} on ${formatDateShort(date)} skipped. Portions recalculated.`);
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) {
          await ctx.reply(`❌ No ${String(mealTypeRaw)} planned for ${formatDateShort(date)}.`);
        } else {
          console.error('[query-handler] Error skipping meal:', err);
          await ctx.reply('⚠️ Failed to skip meal. Please try again.');
        }
      }
      break;
    }

    case 'query_groceries': {
      try {
        const items = await generateGroceryList();
        if (items.length === 0) {
          await ctx.reply('👌 Your pantry covers everything — nothing to buy!');
          break;
        }
        const lines = items.map(
          (item: GroceryItem) =>
            `• *${escapeMarkdown(item.name)}*: ${item.shortfallQuantity} ${escapeMarkdown(item.unit)} (have ${item.currentStock}, need ${item.requiredQuantity})`,
        );
        await ctx.reply(`🛒 *Grocery list:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('[query-handler] Error fetching grocery list:', err);
        await ctx.reply('⚠️ Could not generate grocery list right now. Please try again.');
      }
      break;
    }

    case 'generate_menu': {
      try {
        await ctx.reply('⏳ Generating lunch plan…');
        const entries = await generateLunchPlan(config.app.planHorizonDays);
        if (entries.length === 0) {
          await ctx.reply('📭 No recipes found or all lunch slots already filled.');
          break;
        }
        const planLines = entries.map(
          (e: MealEntry) =>
            `• *${e.date}* (${e.mealType}): ${escapeMarkdown(e.recipeTitle)} ×${e.servings}`,
        );
        const planSection = `🗓 *Lunch plan generated* (${entries.length} meal${entries.length !== 1 ? 's' : ''}):\n\n${planLines.join('\n')}`;

        const groceryItems = await generateGroceryList();
        const grocerySection =
          groceryItems.length === 0
            ? '🛒 *Grocery gap:* Your pantry covers everything — nothing to buy!'
            : `🛒 *Grocery gap:*\n\n${groceryItems
                .map(
                  (item: GroceryItem) =>
                    `• *${escapeMarkdown(item.name)}*: ${item.shortfallQuantity} ${escapeMarkdown(item.unit)} (have ${item.currentStock}, need ${item.requiredQuantity})`,
                )
                .join('\n')}`;

        const combined = `${planSection}\n\n${grocerySection}`;
        const TELEGRAM_MAX = 4096;
        if (combined.length <= TELEGRAM_MAX) {
          await ctx.reply(combined, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply(planSection, { parse_mode: 'Markdown' });
          await ctx.reply(grocerySection, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('[query-handler] Error generating menu:', err);
        await ctx.reply('⚠️ Failed to generate menu. Please try again.');
      }
      break;
    }

    default:
      await ctx.reply("Sorry, I didn't understand that. Type /help to see what I can do.");
  }
}

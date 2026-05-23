import { Telegraf, Context } from 'telegraf';
import { listRecipes, findRecipeByTitle } from '../../services/recipe-store';
import {
  upsertItem,
  listItems,
  setThreshold,
  deductByMeal,
  deleteItem,
} from '../../services/pantry';
import { createEntry, getByDate, skipMeal, markConsumed } from '../../services/meal-planner';
import { IngredientUnitSchema } from '../../models/recipe';
import { MealTypeSchema, MealEntry } from '../../models/meal-plan';

interface AddPantryArgs {
  name: string;
  quantity: number;
  unit: string;
  expiryDate?: string;
}

function parseAddPantryArgs(argsStr: string): AddPantryArgs | null {
  const trimmed = argsStr.trim();
  if (!trimmed) return null;

  let name: string;
  let rest: string;

  if (trimmed.startsWith('"')) {
    const closingQuote = trimmed.indexOf('"', 1);
    if (closingQuote === -1) return null;
    name = trimmed.slice(1, closingQuote).trim();
    rest = trimmed.slice(closingQuote + 1).trim();
  } else {
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return null;
    name = trimmed.slice(0, spaceIdx);
    rest = trimmed.slice(spaceIdx + 1).trim();
  }

  if (!name) return null;

  const parts = rest.split(/\s+/);
  if (parts.length < 2) return null;

  const quantity = parseFloat(parts[0] ?? '');
  if (isNaN(quantity) || quantity < 0) return null;

  const unit = parts[1] ?? '';
  if (!unit) return null;

  let expiryDate: string | undefined;
  const expiryPart = parts.find((p) => p.startsWith('expiry:'));
  if (expiryPart) {
    const dateStr = expiryPart.slice('expiry:'.length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) expiryDate = dateStr;
  }

  return { name, quantity, unit, expiryDate };
}

function formatExpiry(iso?: string): string {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatPantryList(items: Awaited<ReturnType<typeof listItems>>): string {
  if (items.length === 0) return '📭 Pantry is empty. Use /addpantry to add items.';
  const MAX = 50;
  const visible = items.slice(0, MAX);
  const lines = visible.map((item) => {
    const expiry = item.expiryDate ? ` _(expires ${formatExpiry(item.expiryDate)})_` : '';
    const alert =
      item.minThreshold !== undefined && item.quantity <= item.minThreshold ? ' ⚠️' : '';
    return `• ${item.name} — ${item.quantity}${item.unit}${expiry}${alert}`;
  });
  const header = `📦 *Pantry* (${items.length} item${items.length !== 1 ? 's' : ''})`;
  const suffix = items.length > MAX ? `\n_…and ${items.length - MAX} more items_` : '';
  return `${header}\n\n${lines.join('\n')}${suffix}`;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] as string;
}

function formatDateShort(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function formatMealPlan(date: string, entries: MealEntry[]): string {
  if (entries.length === 0) return `🗓 No meals planned for ${formatDateShort(date)}.`;
  const lines = entries.map((e) => {
    const type = e.mealType.charAt(0).toUpperCase() + e.mealType.slice(1);
    const suffix = e.status !== 'planned' ? ` — _${e.status}_` : '';
    return `• ${type}: ${e.recipeTitle} (${e.servings} servings)${suffix}`;
  });
  return `🗓 *Meal plan for ${formatDateShort(date)}:*\n\n${lines.join('\n')}`;
}

interface AddMealArgs {
  date: string;
  mealType: string;
  recipeName: string;
}

function parseAddMealArgs(argsStr: string): AddMealArgs | null {
  const trimmed = argsStr.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;

  const date = parts[0] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const mealType = parts[1] ?? '';
  if (!mealType) return null;

  const rest = parts.slice(2).join(' ');
  const recipeName =
    rest.startsWith('"') && rest.endsWith('"') ? rest.slice(1, -1).trim() : rest.trim();
  if (!recipeName) return null;

  return { date, mealType, recipeName };
}

function parseDateMealType(argsStr: string): { date: string; mealType: string } | null {
  const parts = argsStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const date = parts[0] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const mealType = parts[1] ?? '';
  if (!mealType) return null;
  return { date, mealType };
}

export function registerCommandHandlers(bot: Telegraf<Context>): void {
  bot.command('scan', (ctx) =>
    ctx.reply("📸 Send me a photo of a recipe page and I'll extract and save it for you."),
  );

  bot.command('recipes', async (ctx) => {
    try {
      const { recipes } = await listRecipes();
      if (recipes.length === 0) {
        await ctx.reply('📭 No recipes saved yet. Send me a cookbook photo to get started!');
        return;
      }
      const list = recipes
        .map((r, i) => {
          const link = r.notionUrl ? `[${r.title}](${r.notionUrl})` : r.title;
          return `${i + 1}. ${link}`;
        })
        .join('\n');
      await ctx.reply(`📚 *Saved recipes:*\n\n${list}`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[recipes-command] Error fetching recipes:', err);
      await ctx.reply('⚠️ Could not load recipes right now. Please try again.');
    }
  });

  bot.command('addpantry', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/addpantry\s*/i, '').trim();
    const parsed = parseAddPantryArgs(argsStr);
    if (!parsed) {
      await ctx.reply(
        '❌ Could not parse pantry item.\nFormat: /addpantry <name> <qty> <unit> [expiry:YYYY-MM-DD]\nExample: /addpantry "chicken breast" 500 g expiry:2026-05-30',
      );
      return;
    }

    const unitResult = IngredientUnitSchema.safeParse(parsed.unit);
    const unit = unitResult.success ? unitResult.data : 'other';

    try {
      const item = await upsertItem({
        name: parsed.name,
        quantity: parsed.quantity,
        unit,
        expiryDate: parsed.expiryDate,
      });
      const expiry = item.expiryDate ? ` (expires ${formatExpiry(item.expiryDate)})` : '';
      await ctx.reply(`✅ Added ${item.quantity}${item.unit} ${item.name}${expiry}.`);
    } catch (err) {
      console.error('[addpantry-command] Error upserting pantry item:', err);
      await ctx.reply('⚠️ Failed to update pantry. Please try again.');
    }
  });

  bot.command('pantry', async (ctx) => {
    try {
      const items = await listItems();
      await ctx.reply(formatPantryList(items), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[pantry-command] Error fetching pantry:', err);
      await ctx.reply('⚠️ Could not load pantry right now. Please try again.');
    }
  });

  bot.command('removepantry', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const name = ctx.message.text.replace(/^\/removepantry\s*/i, '').trim();
    if (!name) {
      await ctx.reply(
        '❌ Please provide an item name.\nFormat: /removepantry <name>\nExample: /removepantry pasta',
      );
      return;
    }

    try {
      const removed = await deleteItem(name);
      if (removed) {
        await ctx.reply(`✅ Removed *${name}* from pantry.`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`❌ *${name}* not found in pantry.`, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('[removepantry-command] Error removing pantry item:', err);
      await ctx.reply('⚠️ Failed to remove item. Please try again.');
    }
  });

  bot.command('setthreshold', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/setthreshold\s*/i, '').trim();
    const parsed = parseAddPantryArgs(argsStr);
    if (!parsed) {
      await ctx.reply(
        '❌ Could not parse threshold.\nFormat: /setthreshold <name> <qty> <unit>\nExample: /setthreshold "olive oil" 100 ml',
      );
      return;
    }

    const unitResult = IngredientUnitSchema.safeParse(parsed.unit);
    const unit = unitResult.success ? unitResult.data : 'other';

    try {
      await setThreshold(parsed.name, parsed.quantity, unit);
      await ctx.reply(`✅ Restock alert set: ${parsed.name} < ${parsed.quantity}${unit}.`);
    } catch (err) {
      console.error('[setthreshold-command] Error setting threshold:', err);
      await ctx.reply('⚠️ Failed to set threshold. Please try again.');
    }
  });

  bot.command('plan', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/plan\s*/i, '').trim();
    const date = argsStr && /^\d{4}-\d{2}-\d{2}$/.test(argsStr) ? argsStr : todayIso();

    try {
      const entries = await getByDate(date);
      await ctx.reply(formatMealPlan(date, entries), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[plan-command] Error fetching meal plan:', err);
      await ctx.reply('⚠️ Could not load meal plan right now. Please try again.');
    }
  });

  bot.command('addmeal', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/addmeal\s*/i, '').trim();
    const parsed = parseAddMealArgs(argsStr);

    if (!parsed) {
      await ctx.reply(
        '❌ Could not parse meal.\nFormat: /addmeal <date> <type> <recipe>\nExample: /addmeal 2026-05-25 dinner "Chicken Tikka Masala"',
      );
      return;
    }

    const mealTypeResult = MealTypeSchema.safeParse(parsed.mealType);
    if (!mealTypeResult.success) {
      await ctx.reply('❌ Invalid meal type. Use: breakfast, lunch, or dinner.');
      return;
    }

    try {
      const recipe = await findRecipeByTitle(parsed.recipeName);
      if (!recipe) {
        await ctx.reply('❌ Recipe not found. Use /recipes to browse available recipes.');
        return;
      }

      const entry = await createEntry({
        date: parsed.date,
        mealType: mealTypeResult.data,
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        servings: recipe.servings,
        status: 'planned',
      });

      const type = entry.mealType.charAt(0).toUpperCase() + entry.mealType.slice(1);
      await ctx.reply(
        `✅ ${type} on ${formatDateShort(parsed.date)}: ${recipe.title} (${entry.servings} servings).`,
      );
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        await ctx.reply(
          `❌ A ${parsed.mealType} is already planned for ${formatDateShort(parsed.date)}.`,
        );
      } else {
        console.error('[addmeal-command] Error adding meal:', err);
        await ctx.reply('⚠️ Failed to add meal. Please try again.');
      }
    }
  });

  bot.command('skip', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/skip\s*/i, '').trim();
    const parsed = parseDateMealType(argsStr);

    if (!parsed) {
      await ctx.reply(
        '❌ Could not parse skip.\nFormat: /skip <date> <type>\nExample: /skip 2026-05-25 lunch',
      );
      return;
    }

    const mealTypeResult = MealTypeSchema.safeParse(parsed.mealType);
    if (!mealTypeResult.success) {
      await ctx.reply('❌ Invalid meal type. Use: breakfast, lunch, or dinner.');
      return;
    }

    try {
      await skipMeal(parsed.date, mealTypeResult.data);
      const type = mealTypeResult.data.charAt(0).toUpperCase() + mealTypeResult.data.slice(1);
      await ctx.reply(
        `✅ ${type} on ${formatDateShort(parsed.date)} skipped. Portions recalculated.`,
      );
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        await ctx.reply(`❌ No ${parsed.mealType} planned for ${formatDateShort(parsed.date)}.`);
      } else {
        console.error('[skip-command] Error skipping meal:', err);
        await ctx.reply('⚠️ Failed to skip meal. Please try again.');
      }
    }
  });

  bot.command('eaten', async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const argsStr = ctx.message.text.replace(/^\/eaten\s*/i, '').trim();
    const parsed = parseDateMealType(argsStr);

    if (!parsed) {
      await ctx.reply(
        '❌ Could not parse command.\nFormat: /eaten <date> <type>\nExample: /eaten 2026-05-25 dinner',
      );
      return;
    }

    const mealTypeResult = MealTypeSchema.safeParse(parsed.mealType);
    if (!mealTypeResult.success) {
      await ctx.reply('❌ Invalid meal type. Use: breakfast, lunch, or dinner.');
      return;
    }

    try {
      const entries = await getByDate(parsed.date);
      const entry = entries.find((e) => e.mealType === mealTypeResult.data);
      if (!entry) {
        await ctx.reply(`❌ No ${parsed.mealType} planned for ${formatDateShort(parsed.date)}.`);
        return;
      }

      await markConsumed(entry.id, (ingredients) => deductByMeal(ingredients));

      const type = mealTypeResult.data.charAt(0).toUpperCase() + mealTypeResult.data.slice(1);
      await ctx.reply(`✅ ${type} marked as done. Pantry updated.`);
    } catch (err) {
      console.error('[eaten-command] Error marking meal consumed:', err);
      await ctx.reply('⚠️ Failed to mark meal as consumed. Please try again.');
    }
  });
}

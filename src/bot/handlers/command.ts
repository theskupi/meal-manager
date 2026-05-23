import { Telegraf, Context } from 'telegraf';
import { listRecipes } from '../../services/recipe-store';
import { upsertItem, listItems, setThreshold } from '../../services/pantry';
import { IngredientUnitSchema } from '../../models/recipe';

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

export function registerCommandHandlers(bot: Telegraf<Context>): void {
  bot.hears(/^hello$/i, (ctx) =>
    ctx.reply(
      "👋 Hello! I'm PapiPap, your kitchen assistant.\n\n" +
        "📸 Send me a cookbook photo and I'll scan the recipe into Notion.",
    ),
  );

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
}

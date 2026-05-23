import { Telegraf, Context } from 'telegraf';
import { listRecipes } from '../../services/recipe-store';

export function registerCommandHandlers(bot: Telegraf<Context>): void {
  bot.hears(/^hello$/i, (ctx) =>
    ctx.reply(
      '👋 Hello! I\'m PapiPap, your kitchen assistant.\n\n' +
        '📸 Send me a cookbook photo and I\'ll scan the recipe into Notion.',
    ),
  );

  bot.command('scan', (ctx) =>
    ctx.reply('📸 Send me a photo of a recipe page and I\'ll extract and save it for you.'),
  );

  bot.command('recipes', async (ctx) => {
    try {
      const { recipes } = await listRecipes();
      if (recipes.length === 0) {
        await ctx.reply("📭 No recipes saved yet. Send me a cookbook photo to get started!");
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
}

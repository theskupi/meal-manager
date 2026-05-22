import { Context } from 'telegraf';
import { ExtractionError, NoRecipeFoundError } from '../../integrations/gemini';
import { scanPhoto } from '../../services/recipe-scanner';
import { saveRecipe } from '../../services/recipe-store';

export async function photoHandler(ctx: Context): Promise<void> {
  if (!ctx.message || !('photo' in ctx.message)) return;

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  if (!largest) return;

  const statusMsg = await ctx.reply('📸 Got your photo! Scanning for a recipe…');

  try {
    const recipe = await scanPhoto(largest.file_id);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `⏳ Found *${recipe.title}* — saving to Notion…`,
      { parse_mode: 'Markdown' },
    );

    const sourcePhotoUrl = `https://api.telegram.org/file/bot${process.env['TELEGRAM_BOT_TOKEN']}/${largest.file_id}`;
    const { url } = await saveRecipe(recipe, sourcePhotoUrl);

    const ingredientList = recipe.ingredients
      .slice(0, 5)
      .map((i) => `• ${i.quantity} ${i.unit} ${i.name}`)
      .join('\n');
    const more =
      recipe.ingredients.length > 5 ? `\n_…and ${recipe.ingredients.length - 5} more_` : '';

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `✅ *${recipe.title}* saved!\n\n` +
        `👥 Servings: ${recipe.servings}` +
        (recipe.prepTimeMinutes ? `  ⏱ ${recipe.prepTimeMinutes} min` : '') +
        `\n\n*Ingredients:*\n${ingredientList}${more}\n\n` +
        `[Open in Notion](${url})`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    if (err instanceof NoRecipeFoundError) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        "🤷 I couldn't find a recipe in that photo. Try a clearer image of a recipe page.",
      );
      return;
    }
    if (err instanceof ExtractionError) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        '⚠️ I found a recipe but had trouble reading it. Please try again or send a clearer photo.',
      );
      return;
    }
    console.error('[photo-handler] Unexpected error:', err);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      '❌ Something went wrong. Please try again in a moment.',
    );
  }
}

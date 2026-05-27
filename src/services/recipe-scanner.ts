import { config } from '../config';
import { extractRecipe } from '../integrations/gemini';
import { bot } from '../integrations/telegram';
import { Recipe } from '../models/recipe';

export { ExtractionError, NoRecipeFoundError } from '../integrations/gemini';

async function downloadPhotoAsBase64(fileId: string): Promise<string> {
  const file = await bot.telegram.getFile(fileId);
  if (!file.file_path) {
    throw new Error(`Could not resolve file path for file ID: ${fileId}`);
  }
  if (!/^[\w.\-/]+$/.test(file.file_path)) {
    throw new Error(`Unexpected file_path format returned by Telegram API`);
  }
  const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(
      `Failed to download photo (network error): ${err instanceof Error ? err.message.replace(config.telegram.botToken, '<redacted>') : 'unknown'}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to download photo: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export async function scanPhoto(fileId: string): Promise<Recipe> {
  console.info('[recipe-scanner] Starting photo scan');
  const base64 = await downloadPhotoAsBase64(fileId);
  const recipe = await extractRecipe(base64);
  console.info(
    `[recipe-scanner] Extraction complete — recipe: "${recipe.title}" (${recipe.ingredients.length} ingredients)`,
  );
  return recipe;
}

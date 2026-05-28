import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { Recipe, RecipeSchema } from '../models/recipe';

const FLASH_MODEL = 'gemini-2.5-flash';
const MIN_INGREDIENTS_THRESHOLD = 3;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 4000;

export class NoRecipeFoundError extends Error {
  constructor() {
    super('No recipe found in the provided image');
    this.name = 'NoRecipeFoundError';
  }
}

export class QuotaExceededError extends Error {
  constructor() {
    super('Gemini API quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const EXTRACTION_PROMPT = `You are a recipe extraction assistant. Analyse the cookbook photo and extract the recipe.

Return ONLY a valid JSON object matching this exact structure. Do not include any explanation, markdown, or code fences — only the raw JSON object.

{
  "title": "string — recipe name",
  "servings": "number — number of servings (default 4 if not shown)",
  "prepTimeMinutes": "number or null — preparation time in minutes",
  "ingredients": [
    {
      "name": "string — ingredient name, lowercase",
      "quantity": "number — numeric quantity",
      "unit": "one of: g|kg|ml|l|cup|tbsp|tsp|piece|slice|other",
      "notes": "string or null"
    }
  ],
  "steps": [
    "string — step instruction, written in the same language as the recipe text in the image"
  ],
  "tags": ["string — descriptive tag"]
}

If the image does not contain a recipe, return: {"error": "no_recipe_found"}
If a field cannot be determined, use null for optional fields or a sensible default.
Preserve the original language of all text fields (title, steps, ingredient names, notes) exactly as it appears in the image. Do not translate anything.`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusCode(err: unknown): number {
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return 0;
}

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

async function callModel(modelName: string, imageBase64: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: modelName });
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent([
        { text: EXTRACTION_PROMPT },
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
      ]);
      return result.response.text();
    } catch (err) {
      lastError = err;
      const status = getStatusCode(err);
      const isRetryable = status === 429 || status >= 500;
      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
        console.warn(`[gemini] Retryable error (${status}), retrying in ${backoffMs}ms`);
        await delay(backoffMs);
        continue;
      }
      if (status === 429) throw new QuotaExceededError();
      throw err;
    }
  }
  throw lastError;
}

function parseRecipeJson(raw: string): Recipe | null {
  let parsed: unknown;
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    (parsed as { error: unknown }).error === 'no_recipe_found'
  ) {
    throw new NoRecipeFoundError();
  }

  const result = RecipeSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function extractRecipe(imageBase64: string): Promise<Recipe> {
  const flashRaw = await callModel(FLASH_MODEL, imageBase64);
  const flashRecipe = parseRecipeJson(flashRaw);

  if (flashRecipe && flashRecipe.ingredients.length >= MIN_INGREDIENTS_THRESHOLD) {
    return flashRecipe;
  }

  throw new ExtractionError(
    `Flash model returned ${flashRecipe ? `only ${flashRecipe.ingredients.length} ingredient(s)` : 'an unparseable response'}.`,
  );
}

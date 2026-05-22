import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import { notionClient, withRetry } from '../integrations/notion';
import { Recipe, StoredRecipe, StoredRecipeSchema, IngredientUnitSchema } from '../models/recipe';

type NotionProperties = Parameters<typeof notionClient.pages.create>[0]['properties'];

const MAX_RICH_TEXT_LENGTH = 2000;

function truncateJson(data: unknown): string {
  const serialised = JSON.stringify(data);
  return serialised.length > MAX_RICH_TEXT_LENGTH
    ? serialised.slice(0, MAX_RICH_TEXT_LENGTH - 3) + '...'
    : serialised;
}

export async function saveRecipe(
  recipe: Recipe,
  sourcePhotoUrl?: string,
): Promise<{ id: string; url: string }> {
  const properties: NotionProperties = {
    Title: {
      title: [{ text: { content: recipe.title } }],
    },
    Ingredients: {
      rich_text: [{ text: { content: truncateJson(recipe.ingredients) } }],
    },
    Steps: {
      rich_text: [{ text: { content: truncateJson(recipe.steps) } }],
    },
    Servings: {
      number: recipe.servings,
    },
  };

  if (recipe.prepTimeMinutes !== null && recipe.prepTimeMinutes !== undefined) {
    properties['Prep Time (min)'] = { number: recipe.prepTimeMinutes };
  }

  if (sourcePhotoUrl) {
    properties['Source Photo'] = { url: sourcePhotoUrl };
  }

  if (recipe.tags && recipe.tags.length > 0) {
    properties['Tags'] = {
      multi_select: recipe.tags.map((tag) => ({ name: tag })),
    };
  }

  const page = await withRetry(() =>
    notionClient.pages.create({
      parent: { database_id: config.notion.recipesDatabaseId },
      properties,
    }),
  );

  const url =
    'url' in page ? (page.url as string) : `https://www.notion.so/${page.id.replace(/-/g, '')}`;
  return { id: page.id, url };
}

export async function listRecipes(startCursor?: string): Promise<{
  recipes: StoredRecipe[];
  nextCursor: string | null;
}> {
  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.recipesDatabaseId,
      page_size: 10,
      start_cursor: startCursor,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    }),
  );

  const recipes: StoredRecipe[] = response.results
    .map((page) => {
      if (!('properties' in page)) return null;
      const fullPage = page as PageObjectResponse;
      const props = fullPage.properties as unknown as Record<string, unknown>;

      const titleProp = props['Title'] as unknown as { title: Array<{ plain_text: string }> };
      const title = (titleProp?.title ?? []).map((t) => t.plain_text).join('');

      const ingredientsProp = props['Ingredients'] as unknown as {
        rich_text: Array<{ plain_text: string }>;
      };
      const ingredientsRaw = (ingredientsProp?.rich_text ?? []).map((r) => r.plain_text).join('');

      const stepsProp = props['Steps'] as unknown as { rich_text: Array<{ plain_text: string }> };
      const stepsRaw = (stepsProp?.rich_text ?? []).map((r) => r.plain_text).join('') || '[]';

      const servingsProp = props['Servings'] as unknown as { number: number };
      const servings = servingsProp?.number ?? 4;

      const prepTimeProp = props['Prep Time (min)'] as unknown as { number: number | null };
      const prepTime = prepTimeProp?.number ?? null;

      const photoProp = props['Source Photo'] as unknown as { url: string | null };
      const sourcePhoto = photoProp?.url ?? undefined;

      const tagsProp = props['Tags'] as unknown as { multi_select: Array<{ name: string }> };
      const tags = (tagsProp?.multi_select ?? []).map((t) => t.name);

      let ingredients: unknown[] = [];
      let steps: unknown[] = [];
      try {
        ingredients = JSON.parse(ingredientsRaw) as unknown[];
        steps = JSON.parse(stepsRaw) as unknown[];
      } catch {
        return null;
      }

      const normalised = ingredients.map((ing) => {
        const i = ing as Record<string, unknown>;
        const unitResult = IngredientUnitSchema.safeParse(i['unit']);
        return {
          name: String(i['name'] ?? ''),
          quantity: Number(i['quantity'] ?? 0),
          unit: unitResult.success ? unitResult.data : ('other' as const),
          notes: i['notes'] != null ? String(i['notes']) : null,
        };
      });

      const result = StoredRecipeSchema.safeParse({
        id: page.id,
        title,
        servings,
        prepTimeMinutes: prepTime,
        ingredients: normalised,
        steps: steps.map(String),
        tags,
        sourcePhotoUrl: sourcePhoto,
        notionUrl: 'url' in page ? (page as PageObjectResponse).url : undefined,
        createdAt: fullPage.created_time,
      });

      return result.success ? result.data : null;
    })
    .filter((r): r is StoredRecipe => r !== null);

  return {
    recipes,
    nextCursor: response.next_cursor ?? null,
  };
}

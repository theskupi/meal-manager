import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import { notionClient, withRetry } from '../integrations/notion';
import {
  MealEntry,
  MealEntryInput,
  MealType,
  MealStatusSchema,
  MealTypeSchema,
} from '../models/meal-plan';
import { Ingredient, IngredientUnitSchema } from '../models/recipe';
import { restoreBySkippedMeal, deductByMeal } from './pantry';

type NotionProperties = Parameters<typeof notionClient.pages.create>[0]['properties'];

function parseMealEntryPage(page: PageObjectResponse): MealEntry | null {
  const props = page.properties as unknown as Record<string, unknown>;

  const dateProp = props['Date'] as { date: { start: string } | null } | undefined;
  const date = dateProp?.date?.start;
  if (!date) return null;

  const mealTypeProp = props['Meal Type'] as { select: { name: string } | null } | undefined;
  const mealTypeRaw = mealTypeProp?.select?.name ?? '';
  const mealTypeResult = MealTypeSchema.safeParse(mealTypeRaw);
  if (!mealTypeResult.success) return null;

  const recipeTitleProp = props['Recipe Title'] as
    | { rich_text: Array<{ plain_text: string }> }
    | undefined;
  const recipeTitle = (recipeTitleProp?.rich_text ?? []).map((t) => t.plain_text).join('');

  const servingsProp = props['Servings'] as { number: number | null } | undefined;
  const servings = servingsProp?.number ?? 4;

  const statusProp = props['Status'] as { select: { name: string } | null } | undefined;
  const statusRaw = statusProp?.select?.name ?? 'planned';
  const statusResult = MealStatusSchema.safeParse(statusRaw);
  const status = statusResult.success ? statusResult.data : ('planned' as const);

  const notesProp = props['Notes'] as { rich_text: Array<{ plain_text: string }> } | undefined;
  const notesText = (notesProp?.rich_text ?? []).map((t) => t.plain_text).join('');
  const notes = notesText || undefined;

  const recipeProp = props['Recipe'] as { relation: Array<{ id: string }> } | undefined;
  const recipeId = recipeProp?.relation?.[0]?.id;

  return {
    id: page.id,
    date,
    mealType: mealTypeResult.data,
    recipeId,
    recipeTitle,
    servings,
    status,
    notes,
  };
}

async function findByDateAndType(date: string, mealType: MealType): Promise<MealEntry | null> {
  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.mealPlanDatabaseId,
      filter: {
        and: [
          { property: 'Date', date: { equals: date } },
          { property: 'Meal Type', select: { equals: mealType } },
        ],
      },
    }),
  );

  const page = response.results.find((p): p is PageObjectResponse => 'properties' in p);
  return page ? parseMealEntryPage(page) : null;
}

export async function createEntry(entry: MealEntryInput): Promise<MealEntry> {
  const duplicate = await findByDateAndType(entry.date, entry.mealType);
  if (duplicate) {
    throw new Error(`Meal entry already exists for ${entry.date} ${entry.mealType}`);
  }

  const title = `${entry.date} ${entry.mealType}`;
  const properties: NotionProperties = {
    Title: { title: [{ text: { content: title } }] },
    Date: { date: { start: entry.date } },
    'Meal Type': { select: { name: entry.mealType } },
    'Recipe Title': { rich_text: [{ text: { content: entry.recipeTitle } }] },
    Servings: { number: entry.servings ?? 4 },
    Status: { select: { name: entry.status ?? 'planned' } },
  };

  if (entry.recipeId) {
    properties['Recipe'] = { relation: [{ id: entry.recipeId }] };
  }
  if (entry.notes) {
    properties['Notes'] = { rich_text: [{ text: { content: entry.notes } }] };
  }

  const page = await withRetry(() =>
    notionClient.pages.create({
      parent: { database_id: config.notion.mealPlanDatabaseId },
      properties,
    }),
  );

  return (
    parseMealEntryPage(page as PageObjectResponse) ?? {
      id: page.id,
      date: entry.date,
      mealType: entry.mealType,
      recipeId: entry.recipeId,
      recipeTitle: entry.recipeTitle,
      servings: entry.servings ?? 4,
      status: entry.status ?? 'planned',
      notes: entry.notes,
    }
  );
}

export async function getByDate(date: string): Promise<MealEntry[]> {
  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.mealPlanDatabaseId,
      filter: { property: 'Date', date: { equals: date } },
      sorts: [{ property: 'Meal Type', direction: 'ascending' }],
    }),
  );

  return response.results
    .filter((p): p is PageObjectResponse => 'properties' in p)
    .map(parseMealEntryPage)
    .filter((e): e is MealEntry => e !== null);
}

export async function getWeekPlan(from: string, days: number): Promise<MealEntry[]> {
  const toDate = new Date(from + 'T00:00:00Z');
  toDate.setUTCDate(toDate.getUTCDate() + days);
  const to = toDate.toISOString().split('T')[0] as string;

  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.mealPlanDatabaseId,
      filter: {
        and: [
          { property: 'Date', date: { on_or_after: from } },
          { property: 'Date', date: { before: to } },
        ],
      },
      sorts: [{ property: 'Date', direction: 'ascending' }],
    }),
  );

  return response.results
    .filter((p): p is PageObjectResponse => 'properties' in p)
    .map(parseMealEntryPage)
    .filter((e): e is MealEntry => e !== null);
}

async function fetchRecipeData(
  recipeId: string,
): Promise<{ ingredients: Ingredient[]; servings: number }> {
  const recipePage = await withRetry(() => notionClient.pages.retrieve({ page_id: recipeId }));
  const recipeProps = (recipePage as PageObjectResponse).properties as unknown as Record<
    string,
    unknown
  >;

  const servingsProp = recipeProps['Servings'] as { number: number | null } | undefined;
  const servings = servingsProp?.number ?? 4;

  const ingredientsProp = recipeProps['Ingredients'] as
    | { rich_text: Array<{ plain_text: string }> }
    | undefined;
  const ingredientsJson = (ingredientsProp?.rich_text ?? []).map((t) => t.plain_text).join('');

  let ingredients: Ingredient[] = [];
  if (ingredientsJson) {
    try {
      const raw = JSON.parse(ingredientsJson) as unknown[];
      ingredients = raw
        .map((item) => {
          const i = item as Record<string, unknown>;
          const unitResult = IngredientUnitSchema.safeParse(i['unit']);
          return {
            name: String(i['name'] ?? ''),
            quantity: Number(i['quantity'] ?? 0),
            unit: unitResult.success ? unitResult.data : ('other' as const),
            notes: i['notes'] != null ? String(i['notes']) : null,
          };
        })
        .filter((i) => i.name);
    } catch {
      console.warn('[meal-planner] Could not parse recipe ingredients JSON');
    }
  }

  return { ingredients, servings };
}

export async function skipMeal(date: string, type: MealType): Promise<void> {
  const entry = await findByDateAndType(date, type);
  if (!entry) {
    throw new Error(`Meal entry not found for ${date} ${type}`);
  }

  if (entry.recipeId) {
    try {
      const { ingredients } = await fetchRecipeData(entry.recipeId);
      if (ingredients.length > 0) {
        await restoreBySkippedMeal(ingredients);
      }
    } catch (err) {
      console.warn('[meal-planner] Could not restore pantry for skipped meal:', err);
    }
  }

  await withRetry(() =>
    notionClient.pages.update({
      page_id: entry.id,
      properties: { Status: { select: { name: 'skipped' } } },
    }),
  );
}

export async function updateServings(id: string, newServings: number): Promise<MealEntry> {
  const page = await withRetry(() => notionClient.pages.retrieve({ page_id: id }));
  const entry = parseMealEntryPage(page as PageObjectResponse);
  if (!entry) {
    throw new Error(`Meal entry not found: ${id}`);
  }

  const oldServings = entry.servings;

  if (entry.recipeId && oldServings !== newServings) {
    try {
      const { ingredients, servings: recipeServings } = await fetchRecipeData(entry.recipeId);
      const deltaIngredients = ingredients
        .map((ing) => ({
          ...ing,
          quantity: Math.abs((ing.quantity ?? 0) * (newServings - oldServings)) / recipeServings,
        }))
        .filter((ing) => ing.quantity > 0);

      if (deltaIngredients.length > 0) {
        if (newServings < oldServings) {
          await restoreBySkippedMeal(deltaIngredients);
        } else {
          await deductByMeal(deltaIngredients);
        }
      }
    } catch (err) {
      console.warn('[meal-planner] Could not adjust pantry for servings change:', err);
    }
  }

  const updated = await withRetry(() =>
    notionClient.pages.update({
      page_id: id,
      properties: { Servings: { number: newServings } },
    }),
  );

  return (
    parseMealEntryPage(updated as PageObjectResponse) ?? {
      ...entry,
      servings: newServings,
    }
  );
}

export async function markConsumed(
  id: string,
  onConsumed: (ingredients: Ingredient[]) => Promise<void>,
): Promise<void> {
  const page = await withRetry(() => notionClient.pages.retrieve({ page_id: id }));
  const entry = parseMealEntryPage(page as PageObjectResponse);
  if (!entry) {
    throw new Error(`Meal entry not found: ${id}`);
  }
  if (entry.status === 'consumed') {
    throw new Error(`Meal entry already consumed: ${id}`);
  }

  let ingredients: Ingredient[] = [];

  if (entry.recipeId) {
    try {
      const recipePage = await withRetry(() =>
        notionClient.pages.retrieve({ page_id: entry.recipeId! }),
      );
      const recipeProps = (recipePage as PageObjectResponse).properties as unknown as Record<
        string,
        unknown
      >;
      const ingredientsProp = recipeProps['Ingredients'] as
        | { rich_text: Array<{ plain_text: string }> }
        | undefined;
      const ingredientsJson = (ingredientsProp?.rich_text ?? []).map((t) => t.plain_text).join('');

      if (ingredientsJson) {
        try {
          const raw = JSON.parse(ingredientsJson) as unknown[];
          ingredients = raw
            .map((item) => {
              const i = item as Record<string, unknown>;
              const unitResult = IngredientUnitSchema.safeParse(i['unit']);
              return {
                name: String(i['name'] ?? ''),
                quantity: Number(i['quantity'] ?? 0),
                unit: unitResult.success ? unitResult.data : ('other' as const),
                notes: i['notes'] != null ? String(i['notes']) : null,
              };
            })
            .filter((i) => i.name);
        } catch {
          console.warn('[meal-planner] Could not parse recipe ingredients JSON');
        }
      }
    } catch (err) {
      console.warn('[meal-planner] Could not fetch recipe for consumed meal:', err);
    }
  }

  await onConsumed(ingredients);

  await withRetry(() =>
    notionClient.pages.update({
      page_id: id,
      properties: { Status: { select: { name: 'consumed' } } },
    }),
  );
}

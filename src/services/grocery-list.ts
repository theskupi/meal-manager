import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import { notionClient, withRetry } from '../integrations/notion';
import { GroceryItem } from '../models/grocery-list';
import { Ingredient, IngredientUnitSchema } from '../models/recipe';
import { getWeekPlan } from './meal-planner';
import { listItems } from './pantry';

async function fetchRecipeIngredients(
  recipeId: string,
  entryServings: number,
): Promise<Ingredient[]> {
  try {
    const page = await withRetry(() => notionClient.pages.retrieve({ page_id: recipeId }));
    const props = (page as PageObjectResponse).properties as unknown as Record<string, unknown>;

    const servingsProp = props['Servings'] as { number: number | null } | undefined;
    const recipeServingsRaw = servingsProp?.number;
    if (recipeServingsRaw !== undefined && recipeServingsRaw !== null && recipeServingsRaw <= 0) {
      console.warn(
        `[grocery-list] Recipe ${recipeId} has invalid Servings value (${recipeServingsRaw}). Falling back to default of 4.`,
      );
    }
    const recipeServings = recipeServingsRaw && recipeServingsRaw > 0 ? recipeServingsRaw : 4;
    const scale = entryServings / recipeServings;

    const ingredientsProp = props['Ingredients'] as
      | { rich_text: Array<{ plain_text: string }> }
      | undefined;
    const json = (ingredientsProp?.rich_text ?? []).map((t) => t.plain_text).join('');
    if (!json) return [];

    const raw = JSON.parse(json) as unknown[];
    return raw
      .map((item) => {
        const i = item as Record<string, unknown>;
        const unitResult = IngredientUnitSchema.safeParse(i['unit']);
        return {
          name: String(i['name'] ?? ''),
          quantity: Number(i['quantity'] ?? 0) * scale,
          unit: unitResult.success ? unitResult.data : ('other' as const),
          notes: i['notes'] != null ? String(i['notes']) : null,
        };
      })
      .filter((i) => i.name);
  } catch {
    console.warn(`[grocery-list] Could not fetch ingredients for recipe ${recipeId}`);
    return [];
  }
}

export async function generate(): Promise<GroceryItem[]> {
  const today = new Date().toISOString().split('T')[0] as string;
  const entries = await getWeekPlan(today, config.app.planHorizonDays);

  const required = new Map<string, { name: string; quantity: number; unit: string }>();

  for (const entry of entries) {
    if (entry.status === 'skipped' || !entry.recipeId) continue;
    const ingredients = await fetchRecipeIngredients(entry.recipeId, entry.servings);
    for (const ing of ingredients) {
      const key = `${ing.name.toLowerCase()}::${ing.unit}`;
      const existing = required.get(key);
      if (existing) {
        existing.quantity += ing.quantity ?? 0;
      } else {
        required.set(key, {
          name: ing.name.toLowerCase(),
          quantity: ing.quantity ?? 0,
          unit: ing.unit,
        });
      }
    }
  }

  const pantryItems = await listItems();
  const pantryMap = new Map<string, number>(
    pantryItems.map((item) => [`${item.name.toLowerCase()}::${item.unit}`, item.quantity]),
  );

  const groceries: GroceryItem[] = [];
  for (const [key, req] of required) {
    const currentStock = pantryMap.get(key) ?? 0;
    const shortfall = req.quantity - currentStock;
    if (shortfall > 0) {
      const unitResult = IngredientUnitSchema.safeParse(req.unit);
      groceries.push({
        name: req.name,
        requiredQuantity: req.quantity,
        currentStock,
        shortfallQuantity: shortfall,
        unit: unitResult.success ? unitResult.data : 'other',
      });
    }
  }

  return groceries.sort((a, b) => a.name.localeCompare(b.name));
}

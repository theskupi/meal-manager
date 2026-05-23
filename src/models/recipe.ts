import { z } from 'zod';

export const IngredientUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'cup',
  'tbsp',
  'tsp',
  'piece',
  'slice',
  'other',
]);
export type IngredientUnit = z.infer<typeof IngredientUnitSchema>;

const TO_GRAMS: Partial<Record<IngredientUnit, number>> = {
  g: 1,
  kg: 1000,
};

const TO_ML: Partial<Record<IngredientUnit, number>> = {
  ml: 1,
  l: 1000,
  cup: 240,
  tbsp: 15,
  tsp: 5,
};

export function convertToUnit(
  qty: number,
  fromUnit: IngredientUnit,
  toUnit: IngredientUnit,
): number | null {
  if (fromUnit === toUnit) return qty;
  const fromG = TO_GRAMS[fromUnit];
  const toG = TO_GRAMS[toUnit];
  if (fromG !== undefined && toG !== undefined) return (qty * fromG) / toG;
  const fromMl = TO_ML[fromUnit];
  const toMl = TO_ML[toUnit];
  if (fromMl !== undefined && toMl !== undefined) return (qty * fromMl) / toMl;
  return null;
}

export const IngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().min(0).nullable().default(0),
  unit: IngredientUnitSchema,
  notes: z.string().nullable().default(null),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const RecipeSchema = z.object({
  title: z.string().min(1),
  servings: z.number().int().positive().default(4),
  prepTimeMinutes: z.number().int().positive().nullable().default(null),
  ingredients: z.array(IngredientSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).default([]),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const StoredRecipeSchema = RecipeSchema.extend({
  id: z.string(),
  notionUrl: z.string().url().optional(),
  createdAt: z.string(),
});
export type StoredRecipe = z.infer<typeof StoredRecipeSchema>;

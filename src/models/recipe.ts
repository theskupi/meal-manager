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

export const IngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
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
  sourcePhotoUrl: z.string().url().optional(),
  notionUrl: z.string().url().optional(),
  createdAt: z.string(),
});
export type StoredRecipe = z.infer<typeof StoredRecipeSchema>;

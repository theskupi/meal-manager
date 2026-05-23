import { z } from 'zod';

export const MealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner']);
export type MealType = z.infer<typeof MealTypeSchema>;

export const MealStatusSchema = z.enum(['planned', 'consumed', 'skipped']);
export type MealStatus = z.infer<typeof MealStatusSchema>;

export const MealEntrySchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: MealTypeSchema,
  recipeId: z.string().optional(),
  recipeTitle: z.string(),
  servings: z.number().int().min(1).default(4),
  status: MealStatusSchema.default('planned'),
  notes: z.string().optional(),
});
export type MealEntry = z.infer<typeof MealEntrySchema>;

export const MealEntryInputSchema = MealEntrySchema.omit({ id: true });
export type MealEntryInput = z.infer<typeof MealEntryInputSchema>;

import { z } from 'zod';
import { IngredientUnitSchema } from './recipe';

export const GroceryItemSchema = z.object({
  name: z.string().min(1),
  requiredQuantity: z.number(),
  currentStock: z.number(),
  shortfallQuantity: z.number().positive(),
  unit: IngredientUnitSchema,
});
export type GroceryItem = z.infer<typeof GroceryItemSchema>;

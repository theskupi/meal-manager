import { z } from 'zod';
import { IngredientUnitSchema } from './recipe';

export const PantryItemInputSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().min(0),
  unit: IngredientUnitSchema,
  expiryDate: z.string().optional(),
  minThreshold: z.number().min(0).optional(),
});
export type PantryItemInput = z.infer<typeof PantryItemInputSchema>;

export const PantryItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  quantity: z.number().min(0),
  unit: IngredientUnitSchema,
  expiryDate: z.string().optional(),
  minThreshold: z.number().min(0).optional(),
  updatedAt: z.string(),
});
export type PantryItem = z.infer<typeof PantryItemSchema>;

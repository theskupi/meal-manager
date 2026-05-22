# Data Model: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Phase 1 Output** | **Date**: 2026-05-22 | **Plan**: [plan.md](./plan.md)

All entities are backed by Notion databases. TypeScript types and Zod schemas are derived
from these definitions and live in `src/models/`. Notion property names appear in `"quotes"`.

---

## Entity: Ingredient

Represents a single food item with a quantity and unit. Used both as a recipe component
and as a pantry stock record.

| Field | Type | Notion Property | Notes |
|-------|------|-----------------|-------|
| `name` | `string` | `"Name"` (title) | Required. e.g. "chicken breast" |
| `quantity` | `number` | `"Quantity"` (number) | Required. e.g. 500 |
| `unit` | `IngredientUnit` | `"Unit"` (select) | Required. See enum below |
| `notes` | `string \| undefined` | `"Notes"` (rich text) | Optional. e.g. "diced" |

**IngredientUnit enum**: `g` | `kg` | `ml` | `l` | `cup` | `tbsp` | `tsp` | `piece` | `slice` | `other`

---

## Entity: Recipe

Represents a complete dish extracted from a cookbook photo or manually entered.

| Field | Type | Notion Property | Notes |
|-------|------|-----------------|-------|
| `id` | `string` | Notion page ID | Auto-assigned by Notion |
| `title` | `string` | `"Title"` (title) | Required |
| `ingredients` | `Ingredient[]` | `"Ingredients"` (rich text JSON) | Stored as serialised JSON string |
| `steps` | `string[]` | `"Steps"` (rich text JSON) | Ordered preparation steps |
| `servings` | `number` | `"Servings"` (number) | Default: 4 |
| `prepTimeMinutes` | `number \| undefined` | `"Prep Time (min)"` (number) | Optional |
| `sourcePhotoUrl` | `string \| undefined` | `"Source Photo"` (url) | Telegram CDN URL or undefined |
| `tags` | `string[]` | `"Tags"` (multi-select) | e.g. ["vegetarian", "quick"] |
| `createdAt` | `string` | `"Created"` (created_time) | ISO 8601; auto-set by Notion |

**State transitions**: None. Recipes are immutable once stored (edit via re-scan or manual
Notion edit).

**Validation rules**:
- `title` must be non-empty
- `ingredients` must contain at least 1 item
- `steps` must contain at least 1 step
- `servings` must be ≥ 1

---

## Entity: PantryItem

Tracks current household stock of a single ingredient.

| Field | Type | Notion Property | Notes |
|-------|------|-----------------|-------|
| `id` | `string` | Notion page ID | Auto-assigned |
| `name` | `string` | `"Name"` (title) | Required. Normalised lowercase |
| `quantity` | `number` | `"Quantity"` (number) | Current stock level |
| `unit` | `IngredientUnit` | `"Unit"` (select) | Same enum as Ingredient |
| `expiryDate` | `string \| undefined` | `"Expiry Date"` (date) | ISO 8601 date string |
| `minThreshold` | `number \| undefined` | `"Min Threshold"` (number) | Restock alert trigger level |
| `updatedAt` | `string` | `"Last Updated"` (last_edited_time) | Auto-set by Notion |

**State transitions**:
- `quantity` decreases when a meal is marked as consumed (via `MealEntry` completion)
- `quantity` increases when user adds stock via Telegram chat
- Alert fires when `quantity <= minThreshold`

**Validation rules**:
- `quantity` must be ≥ 0
- `minThreshold` must be ≥ 0 if defined
- `expiryDate` must be a valid ISO 8601 date if defined

---

## Entity: MealEntry

A single meal slot in the family's plan (one breakfast, lunch, or dinner on one date).

| Field | Type | Notion Property | Notes |
|-------|------|-----------------|-------|
| `id` | `string` | Notion page ID | Auto-assigned |
| `date` | `string` | `"Date"` (date) | ISO 8601 date string |
| `mealType` | `MealType` | `"Meal Type"` (select) | `breakfast` \| `lunch` \| `dinner` |
| `recipeId` | `string \| undefined` | `"Recipe"` (relation) | Notion relation to Recipe |
| `recipeTitle` | `string` | `"Recipe Title"` (rich text) | Denormalised for display |
| `servings` | `number` | `"Servings"` (number) | Actual planned servings for this slot |
| `status` | `MealStatus` | `"Status"` (select) | See enum below |
| `notes` | `string \| undefined` | `"Notes"` (rich text) | e.g. "dining out" |

**MealStatus enum**: `planned` | `consumed` | `skipped`

**State transitions**:
```
planned → consumed  (meal eaten; triggers pantry deduction)
planned → skipped   (meal skipped; triggers cascade recalculation)
```

**Validation rules**:
- `date` must be within the configured planning horizon (5–31 days from today)
- `servings` must be ≥ 1
- A given (date, mealType) combination MUST be unique in the plan

---

## Entity: GroceryItem

A derived line item in a generated shopping list.

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | Ingredient name |
| `requiredQuantity` | `number` | Total needed across all upcoming meals |
| `currentStock` | `number` | Current pantry quantity |
| `shortfallQuantity` | `number` | `requiredQuantity - currentStock` (always > 0) |
| `unit` | `IngredientUnit` | Unit of measurement |

GroceryItems are computed on demand (not persisted). The GroceryList is a `GroceryItem[]`
snapshot generated by `src/services/grocery-list.ts`.

---

## Entity: Notification

Represents a system-triggered message sent to the family via Telegram.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `NotificationType` | `restock_alert` \| `expiry_warning` \| `plan_confirmation` \| `recipe_saved` |
| `message` | `string` | Human-readable notification text |
| `triggeredAt` | `string` | ISO 8601 timestamp |
| `relatedEntityId` | `string \| undefined` | Notion page ID of the triggering entity |

Notifications are not persisted — they are fire-and-forget Telegram messages sent via
`src/services/notifier.ts`.

---

## Relationships

```
Recipe  ←(relation)─  MealEntry
   └── ingredients[]
            ↓ (consumed event)
         PantryItem
            ↓ (quantity < minThreshold)
         Notification (restock_alert)
            ↓ (expiryDate within 48h)
         Notification (expiry_warning)

MealEntry[] + PantryItem[]
            ↓ (diff)
         GroceryItem[] (GroceryList — computed, not stored)
```

---

## Unit Conversion Note

The system does not perform automatic unit conversion in v1 (e.g. cups to grams). If a
recipe uses `cup` and the pantry tracks `g`, the comparison in grocery list generation
will treat them as different ingredients. A unit normalisation service is a planned v2
improvement. The `notes` field on Ingredient can carry conversion hints.

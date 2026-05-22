# Contract: Notion Database Schemas

**Phase 1 Output** | **Date**: 2026-05-22 | **Plan**: [plan.md](../plan.md)

Three Notion databases are required. The family administrator creates these manually in
their Notion workspace, then copies the database IDs into the project `.env` file.

---

## Database 1: Recipes

**Env var**: `NOTION_RECIPES_DB_ID`

| Property Name | Notion Type | Required | Notes |
|---------------|-------------|----------|-------|
| `Title` | Title | ✅ | Recipe name. Primary display field. |
| `Ingredients` | Rich Text | ✅ | Serialised JSON array of `Ingredient[]` |
| `Steps` | Rich Text | ✅ | Serialised JSON array of `string[]` |
| `Servings` | Number | ✅ | Default: 4. Format: Number |
| `Prep Time (min)` | Number | ❌ | Optional. Format: Number |
| `Source Photo` | URL | ❌ | Telegram CDN URL of the original photo |
| `Tags` | Multi-select | ❌ | e.g. vegetarian, quick, pasta |
| `Created` | Created time | auto | Automatically set by Notion |

**Notes**:
- `Ingredients` and `Steps` are stored as JSON strings in Rich Text properties because
  Notion does not support nested arrays natively.
- Maximum Rich Text content: 2,000 characters per property. For recipes with many
  ingredients, consider splitting across multiple properties in a future iteration.

---

## Database 2: Pantry

**Env var**: `NOTION_PANTRY_DB_ID`

| Property Name | Notion Type | Required | Notes |
|---------------|-------------|----------|-------|
| `Name` | Title | ✅ | Ingredient name (normalised lowercase) |
| `Quantity` | Number | ✅ | Current stock. Format: Number |
| `Unit` | Select | ✅ | One of: g, kg, ml, l, cup, tbsp, tsp, piece, slice, other |
| `Expiry Date` | Date | ❌ | ISO 8601 date. No time component needed. |
| `Min Threshold` | Number | ❌ | Restock alert trigger level |
| `Last Updated` | Last edited time | auto | Automatically set by Notion |

**Notes**:
- Pantry items are upserted by name: if a page with the same `Name` already exists,
  its `Quantity` is incremented; otherwise a new page is created.
- The `Unit` select options must be pre-populated in the Notion database before the bot
  starts, or the API will return an error on first write. See quickstart for setup steps.

---

## Database 3: Meal Plan

**Env var**: `NOTION_MEAL_PLAN_DB_ID`

| Property Name | Notion Type | Required | Notes |
|---------------|-------------|----------|-------|
| `Title` | Title | ✅ | Auto-generated: "{date} {meal_type}" e.g. "2026-05-25 dinner" |
| `Date` | Date | ✅ | ISO 8601 date |
| `Meal Type` | Select | ✅ | One of: breakfast, lunch, dinner |
| `Recipe` | Relation | ❌ | Relation to Recipes database |
| `Recipe Title` | Rich Text | ✅ | Denormalised recipe name for display |
| `Servings` | Number | ✅ | Planned serving count for this slot |
| `Status` | Select | ✅ | One of: planned, consumed, skipped |
| `Notes` | Rich Text | ❌ | Free text, e.g. "dining out" |

**Notes**:
- The `(Date, Meal Type)` combination must be unique. The service layer enforces this by
  querying before inserting; Notion itself does not enforce uniqueness constraints.
- `Recipe` relation requires both databases to exist in the same Notion workspace.
- `Status` select options (planned, consumed, skipped) must be pre-populated before first use.

---

## Notion API Interaction Patterns

### Query by property
```
notion.databases.query({
  database_id: NOTION_PANTRY_DB_ID,
  filter: {
    property: "Expiry Date",
    date: { before: twoDaysFromNow }
  }
})
```

### Rate limit handling
All Notion API calls go through a shared client wrapper in `src/integrations/notion.ts`
that enforces a 2.5 req/s throughput limit with exponential backoff on HTTP 429 responses
(max 3 retries, delays: 1 s, 2 s, 4 s).

### Upsert pattern (PantryItem)
1. Query Pantry DB for pages where `Name` equals the ingredient name.
2. If found → PATCH the existing page (`Quantity` += delta).
3. If not found → POST a new page with full properties.

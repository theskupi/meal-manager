# Contract: Gemini Recipe Extraction

**Phase 1 Output** | **Date**: 2026-05-22 | **Plan**: [plan.md](../plan.md)

Defines the request/response contract between `src/services/recipe-scanner.ts` and the
Gemini API client in `src/integrations/gemini.ts`.

---

## Request Contract

### Model

`gemini-2.5-flash`

### Input

| Parameter  | Value                                                     |
| ---------- | --------------------------------------------------------- |
| `mimeType` | `image/jpeg`                                              |
| `data`     | Base64-encoded photo bytes (downloaded from Telegram CDN) |
| `prompt`   | See below                                                 |

### Prompt Template

```
You are a recipe extraction assistant. Analyse the cookbook photo and extract the recipe.

Return ONLY a valid JSON object matching this exact structure. Do not include any
explanation, markdown, or code fences — only the raw JSON object.

{
  "title": "string — recipe name",
  "servings": "number — number of servings (default 4 if not shown)",
  "prepTimeMinutes": "number or null — preparation time in minutes",
  "ingredients": [
    {
      "name": "string — ingredient name, lowercase",
      "quantity": "number — numeric quantity",
      "unit": "one of: g|kg|ml|l|cup|tbsp|tsp|piece|slice|other",
      "notes": "string or null — e.g. diced, room temperature"
    }
  ],
  "steps": [
    "string — step 1 instruction",
    "string — step 2 instruction"
  ],
  "tags": ["string — descriptive tag e.g. vegetarian, quick, pasta"]
}

If the image does not contain a recipe, return: {"error": "no_recipe_found"}
If a field cannot be determined, use null for optional fields or a sensible default.
```

---

## Response Contract

### Success response

```json
{
  "title": "Spaghetti Carbonara",
  "servings": 4,
  "prepTimeMinutes": 20,
  "ingredients": [
    { "name": "spaghetti", "quantity": 400, "unit": "g", "notes": null },
    { "name": "pancetta", "quantity": 150, "unit": "g", "notes": "diced" },
    { "name": "eggs", "quantity": 4, "unit": "piece", "notes": null },
    { "name": "pecorino romano", "quantity": 50, "unit": "g", "notes": "grated" },
    { "name": "black pepper", "quantity": 1, "unit": "tsp", "notes": "freshly ground" }
  ],
  "steps": [
    "Cook spaghetti in salted boiling water until al dente.",
    "Fry pancetta in a pan over medium heat until crispy.",
    "Whisk eggs with grated pecorino and black pepper.",
    "Drain pasta, reserving 100ml pasta water.",
    "Combine hot pasta with pancetta off heat, add egg mixture, toss quickly."
  ],
  "tags": ["italian", "pasta", "quick"]
}
```

### No-recipe response

```json
{ "error": "no_recipe_found" }
```

---

## Validation Flow

```
Gemini raw text response
        ↓
JSON.parse()  →  SyntaxError? → return ExtractionError
        ↓
RecipeSchema.safeParse() (Zod)
        ↓
  Valid & ingredients ≥ 3?  →  return Recipe
  Otherwise               →  return ExtractionError
```

### Zod RecipeSchema (source of truth in `src/models/recipe.ts`)

```typescript
const IngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'piece', 'slice', 'other']),
  notes: z.string().nullable(),
});

const RecipeSchema = z.object({
  title: z.string().min(1),
  servings: z.number().int().positive().default(4),
  prepTimeMinutes: z.number().int().positive().nullable(),
  ingredients: z.array(IngredientSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()).default([]),
});
```

---

## Error Handling

| Condition                                | Action                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| HTTP 429 (rate limit)                    | Exponential backoff: 4 s, 8 s, 16 s (max 3 retries)  |
| HTTP 5xx                                 | Exponential backoff: 2 s, 4 s, 8 s (max 3 retries)   |
| `{"error": "no_recipe_found"}`           | Notify user: "Couldn't find a recipe in this photo." |
| JSON unparseable or ingredient count < 3 | Return extraction error to user                      |
| Network timeout (> 30 s)                 | Return timeout error to user                         |

---

## Groq JSON Repair Prompt

Used when `JSON.parse()` fails on the Gemini response:

```
The following text is a malformed JSON object that should match a recipe schema.
Fix any JSON syntax errors (missing quotes, trailing commas, unescaped characters)
and return ONLY the corrected valid JSON. Do not add or remove any data fields.

Malformed input:
{RAW_GEMINI_OUTPUT}
```

# Research: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Phase 0 Output** | **Date**: 2026-05-22 | **Plan**: [plan.md](./plan.md)

---

## 1. Telegram Bot Library

**Decision**: `telegraf` v4

**Rationale**: telegraf is TypeScript-native with full type definitions, uses a composable
middleware pattern (similar to Express/Koa), has built-in session management, and supports
both long-polling (development) and webhook (production) with a single config toggle. It
handles Telegram file downloads and photo messages natively.

**Alternatives considered**:
- `node-telegram-bot-api` — rejected: weaker TypeScript support, callback-based API
  requires more boilerplate.
- Raw Telegram Bot API over `fetch` — rejected: significant undifferentiated work with no
  type safety.

---

## 2. Gemini API — Vision Model Choice

**Decision**: `gemini-1.5-flash` as primary; `gemini-1.5-pro` as fallback for complex pages

**Rationale**: Gemini Flash is optimised for speed and cost at the expense of some accuracy.
For structured recipe extraction from clear cookbook photos, Flash accuracy is sufficient.
Flash free tier: 15 req/min, 1 million tokens/day. Pro fallback is triggered when Flash
returns an incomplete or low-confidence extraction (fewer than 3 ingredients parsed).

**Recipe extraction approach**:
1. Telegram delivers photo file_id.
2. Bot downloads highest-resolution photo version (Telegram provides up to 4 sizes).
3. Photo is base64-encoded and sent inline in the Gemini API request.
4. Prompt instructs Gemini to return a strict JSON object matching the RecipeSchema.
5. Response is validated with Zod; if validation fails, Groq is called to repair the JSON.

**Alternatives considered**:
- OpenAI GPT-4o-mini — kept as secondary option in constitution but not primary per user
  preference for Gemini.
- Google Cloud Vision OCR + manual parsing — rejected: constitution prohibits manual
  parsing pipelines (Principle II).

---

## 3. Groq / Llama-3 — NLP and JSON Enforcement

**Decision**: `groq-sdk` with `llama-3.3-70b-versatile`

**Rationale**: Groq provides sub-second inference for text-only tasks. Used for:
- Parsing user intent from free-form Telegram messages ("skip lunch tomorrow" → structured
  `MealAdjustment` object).
- Repairing malformed Gemini JSON outputs before re-validation with Zod.
- Generating natural language replies to meal schedule queries.

Free tier: 6,000 req/day, 30 req/min with llama-3.3-70b. Sufficient for a single household.

**Alternatives considered**:
- Gemini for NLP too — rejected: adds cost/latency when Groq is faster and cheaper for
  text-only tasks, and constitution mandates Groq as default for text processing.

---

## 4. Notion as Primary Datastore

**Decision**: `@notionhq/client` v2.x; three Notion databases (Recipes, PantryItems, MealPlan)

**Rationale**: Notion serves dual purpose — API-accessible datastore AND family-facing visual
dashboard. Eliminates the need for a separate database in v1. Notion pages map cleanly to
domain entities. The Notion API supports create/read/update/query operations sufficient for
all v1 requirements.

**Key constraints and mitigations**:
- **Rate limit (3 req/s)**: All bulk writes (grocery list generation, batch pantry updates)
  MUST use a simple queue that throttles to 2.5 req/s with exponential backoff on 429s.
- **No real-time subscriptions**: The bot polls or reacts to Telegram events; Notion is
  write-on-event only. No background sync loop needed.
- **Property type mapping**: Notion rich text → string; number → number; date → ISO string;
  select/multi-select → enum strings. Zod schemas handle the mapping at the integration
  boundary.

**Alternatives considered**:
- PostgreSQL / SQLite — rejected for v1: adds infrastructure complexity and removes the
  family-facing visual dashboard benefit.
- Airtable — rejected: not in the approved service list in the constitution.

---

## 5. Schema Validation Strategy

**Decision**: `zod` v3 as the single validation library; schemas co-located with models

**Rationale**: Zod provides TypeScript type inference from schema definitions, eliminating
the need to maintain separate type declarations. All external API responses (Gemini, Groq,
Notion) are parsed through Zod schemas at the integration boundary. Invalid data is
rejected at the boundary, never propagated into service logic.

**Pattern**:
```typescript
// src/models/recipe.ts
export const RecipeSchema = z.object({ ... });
export type Recipe = z.infer<typeof RecipeSchema>;
```

---

## 6. TypeScript Project Setup

**Decision**: Node 20 LTS, TypeScript 5.x, `ts-node` for development, `tsc` for production

**tsconfig.json key settings**:
- `"strict": true` — constitution requirement
- `"target": "ES2022"` — Node 20 supports all ES2022 features natively
- `"module": "commonjs"` — compatibility with all npm packages
- `"outDir": "dist"` — compiled output
- `"rootDir": "src"` — source root
- `"esModuleInterop": true` — required for some CJS/ESM interop

**Dev tooling**:
- `eslint` + `@typescript-eslint/eslint-plugin` — linting
- `prettier` — formatting
- `jest` + `ts-jest` — testing
- `nodemon` + `ts-node` — development hot reload

---

## 7. Authentication — Telegram User ID Whitelist

**Decision**: Comma-separated Telegram user IDs stored in `TELEGRAM_ALLOWED_USER_IDS`
env var; enforced in `src/bot/middleware/auth.ts` as a telegraf middleware

**Rationale**: Simplest possible access control for a private family bot. No passwords,
no OAuth — just a static list of numeric Telegram user IDs configured by the administrator.
Unauthorised messages are silently ignored (no reply to avoid bot enumeration).

**Implementation**:
```typescript
// auth.ts — runs before all handlers
const allowedIds = config.allowedUserIds; // number[]
bot.use(async (ctx, next) => {
  if (!ctx.from || !allowedIds.includes(ctx.from.id)) return;
  return next();
});
```

---

## 8. Bot Deployment Strategy

**Decision**: Long-polling for local development; webhook for production

**Rationale**: Long-polling requires no public URL and is simpler for development. In
production, webhook mode is more efficient (no repeated polling). A HTTPS reverse proxy
(nginx or a cloud provider's ingress) terminates TLS; the bot listens on a local port.

**Local webhook testing**: `ngrok http 3000` provides a temporary HTTPS URL for webhook
registration during integration testing.

---

## 9. Notion Database IDs

**Decision**: Notion database IDs stored as environment variables; not hardcoded

Three required env vars:
- `NOTION_RECIPES_DB_ID` — the Notion database for recipes
- `NOTION_PANTRY_DB_ID` — the Notion database for pantry items
- `NOTION_MEAL_PLAN_DB_ID` — the Notion database for meal plan entries

The family administrator creates these databases in their Notion workspace using the
schemas defined in `contracts/notion-schemas.md` and copies the IDs into the `.env` file.

---

## 10. Implementation Sequence (per user direction)

The user specified this delivery order, which drives the task prioritisation:

1. **Foundation**: Project scaffold, TypeScript config, env config, auth middleware
2. **Integrations**: Gemini client + Telegram bot (these two unlock US2)
3. **US2 — Recipe Scanner**: Photo handler → Gemini → Zod validation → Notion write
4. **Notion Recipe Store**: Recipe CRUD so scanned recipes persist and are viewable
5. **US3 — Pantry Management**: PantryItem CRUD via Telegram, expiry tracking
6. **US1 — Chat Queries & Plan**: Groq NLP for schedule queries, MealPlan in Notion
7. **US4 — Grocery Lists & Alerts**: Diff service + restock notification dispatch
8. **US5 — Cascade Recalculation**: Portion adjustment logic when plan changes
9. **US6 — Macros** (nice-to-have): Edamam / Open Food Facts integration

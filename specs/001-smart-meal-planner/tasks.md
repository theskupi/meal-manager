---
description: 'Task list for Smart Meal Planner & Automated Kitchen Assistant (PapiPap)'
---

# Tasks: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Input**: Design documents from `specs/001-smart-meal-planner/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/

**Tests**: Included per constitution (unit tests required for all service-layer functions;
integration tests required for each external API boundary).

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing. Implementation order follows user direction: US2 (recipe scan) first, then US3
(pantry), US1 (chat/plan), US5 (cascade), US4 (groceries), US6 (macros).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Project initialisation, tooling, and directory scaffold

- [x] T001 Initialise Node.js project in repo root: create `package.json` (name: meal-manager, engines: node >=20), `tsconfig.json` (strict: true, target: ES2022, module: commonjs, outDir: dist, rootDir: src, esModuleInterop: true), and install core runtime dependencies: `telegraf`, `@google/generative-ai`, `groq-sdk`, `@notionhq/client`, `zod`, `dotenv`
- [x] T002 [P] Configure ESLint + Prettier: install `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `prettier`, `eslint-config-prettier`; create `.eslintrc.json` and `.prettierrc` at repo root
- [x] T003 [P] Configure Jest + ts-jest: install `jest`, `ts-jest`, `@types/jest`; create `jest.config.ts` with two projects (unit: `tests/unit/**/*.test.ts`, integration: `tests/integration/**/*.test.ts`); create empty `tests/unit/` and `tests/integration/` directories
- [x] T004 Create full directory structure per plan.md: `src/integrations/`, `src/models/`, `src/services/`, `src/bot/handlers/`, `src/bot/middleware/`, `src/config/`
- [x] T005 [P] Create `.env.example` with all required vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `NOTION_TOKEN`, `NOTION_RECIPES_DB_ID`, `NOTION_PANTRY_DB_ID`, `NOTION_MEAL_PLAN_DB_ID`, `PLAN_HORIZON_DAYS` (default 5), `PLAN_HORIZON_MAX_DAYS` (default 31), `NODE_ENV`, `TELEGRAM_WEBHOOK_URL` (prod only)
- [x] T006 Add npm scripts to `package.json`: `dev` (nodemon + ts-node src/index.ts), `build` (tsc), `start` (node dist/index.js), `test` (jest --testPathPattern=unit), `test:integration` (jest --testPathPattern=integration), `lint` (eslint src/)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure required before any user story can be implemented

**⚠️ CRITICAL**: No user story work begins until this phase is complete

- [x] T007 Create typed config module `src/config/index.ts`: read all env vars via `dotenv`, export a typed `Config` object; throw at startup if required vars are missing; include `allowedUserIds: number[]` parsed from `TELEGRAM_ALLOWED_USER_IDS`
- [x] T008 [P] Create Notion API client wrapper `src/integrations/notion.ts`: initialise `@notionhq/client`; wrap every API call with a 2.5 req/s token-bucket throttle and exponential backoff (1 s, 2 s, 4 s) on HTTP 429; export typed `notionClient` instance
- [x] T009 [P] Create Telegraf bot instance `src/integrations/telegram.ts`: initialise `telegraf` with `TELEGRAM_BOT_TOKEN`; export `bot` instance; include helper to register webhook URL when `NODE_ENV=production`
- [x] T010 [P] Create auth middleware `src/bot/middleware/auth.ts`: telegraf middleware that reads `config.allowedUserIds`; silently drops messages from unlisted `ctx.from.id` values; logs blocked attempts at debug level
- [x] T011 [P] Create barrel export files: `src/integrations/index.ts` (re-exports notionClient, bot, later geminiClient, groqClient), `src/models/index.ts` (placeholder, populated in US2+)
- [x] T012 Create main entry point `src/index.ts`: import bot and auth middleware; apply auth middleware (`bot.use(authMiddleware)`); call `bot.launch()` with long-poll in dev / webhook in prod; handle `SIGINT`/`SIGTERM` for graceful `bot.stop()`

**Checkpoint**: Run `npm run dev` — bot should start without errors and ignore messages from non-whitelisted users

---

## Phase 3: User Story 2 — AI Recipe Ingestion (Priority: P2) 🎯 MVP

**Goal**: A user sends a cookbook photo via Telegram; a structured recipe appears in Notion

**Independent Test**: Send a cookbook photo → bot replies with recipe title and Notion link
within 30 s; verify recipe entry exists in Notion Recipes database with ≥ 3 ingredients

### Tests for User Story 2 ⚠️ (Write FIRST — must FAIL before implementation)

- [x] T013 [P] [US2] Write unit tests for recipe scanner in `tests/unit/recipe-scanner.test.ts`: mock Gemini and Groq clients; test happy path (valid JSON returned), Zod validation failure → Groq repair path, no-recipe response, timeout handling
- [x] T014 [P] [US2] Write integration tests for Gemini client in `tests/integration/gemini.test.ts`: mock `@google/generative-ai` HTTP layer; test Flash primary / Pro fallback trigger, retry on 429, base64 encoding of photo bytes

### Implementation for User Story 2

- [x] T015 [P] [US2] Create `Ingredient` and `Recipe` Zod schemas and inferred TypeScript types in `src/models/recipe.ts`; include `RecipeSchema`, `IngredientSchema`, `IngredientUnit` enum (g, kg, ml, l, cup, tbsp, tsp, piece, slice, other); update `src/models/index.ts`
- [x] T016 [P] [US2] Create Gemini API client `src/integrations/gemini.ts`: initialise `@google/generative-ai` with `GEMINI_API_KEY`; implement `extractRecipe(imageBase64: string): Promise<Recipe>` — use `gemini-1.5-flash` primary, fall back to `gemini-1.5-pro` when < 3 ingredients parsed; include retry logic for 429/5xx per `contracts/gemini-recipe-extraction.md`; update `src/integrations/index.ts`
- [x] T017 [US2] Create Groq API client `src/integrations/groq.ts`: initialise `groq-sdk` with `GROQ_API_KEY`; implement `repairJson(rawText: string): Promise<string>` using the JSON repair prompt from `contracts/gemini-recipe-extraction.md`; export stub `parseIntent` for later use in US1/US3; update `src/integrations/index.ts`
- [x] T018 [US2] Create recipe scanner service `src/services/recipe-scanner.ts`: implement `scanPhoto(fileId: string): Promise<Recipe>` — download highest-res photo from Telegram CDN using bot file API, base64-encode bytes, call `geminiClient.extractRecipe`, validate with `RecipeSchema.safeParse`, call `groqClient.repairJson` on parse failure and retry once, throw `ExtractionError` if still invalid
- [x] T019 [US2] Create recipe store service `src/services/recipe-store.ts`: implement `saveRecipe(recipe: Recipe): Promise<string>` (returns Notion page URL) and `listRecipes(page: number): Promise<Recipe[]>` (page size 10) using `notionClient` against `NOTION_RECIPES_DB_ID`; serialise `ingredients` and `steps` as JSON strings in Rich Text properties per `contracts/notion-schemas.md`
- [x] T020 [US2] Create photo handler `src/bot/handlers/photo.ts`: handle `bot.on('photo', ...)` — reply "📸 Got it! Scanning recipe, please wait…", call `recipeScanner.scanPhoto`, call `recipeStore.saveRecipe`, reply "✅ Recipe saved: _{title}_ ({n} ingredients). {notionUrl}"; on extraction error reply "❌ Couldn't extract a recipe from this photo. Try a clearer image."
- [x] T021 [US2] Create command handler `src/bot/handlers/command.ts`: implement `/scan` (prompt user to send photo), `/recipes [page]` (list recipes via recipeStore.listRecipes); register photo handler and both commands on `bot` instance in `src/index.ts`

**Checkpoint**: US2 fully functional — cookbook photo → Notion recipe entry end-to-end

---

## Phase 4: User Story 3 — Pantry Inventory Tracking (Priority: P3)

**Goal**: Track household pantry stock; surface expiry warnings proactively

**Independent Test**: `/addpantry "chicken breast" 500 g expiry:2026-05-30` → pantry updated in
Notion; 48 h before expiry bot sends a recipe suggestion notification

### Tests for User Story 3 ⚠️ (Write FIRST — must FAIL before implementation)

- [ ] T022 [P] [US3] Write unit tests for pantry service in `tests/unit/pantry.test.ts`: mock notionClient; test upsert (new item creates, existing item increments), deductByMeal, checkExpiry (returns items expiring within 48 h), checkThresholds (returns items below minThreshold)

### Implementation for User Story 3

- [ ] T023 [P] [US3] Create `PantryItem` Zod schema and TypeScript type in `src/models/pantry-item.ts`; update `src/models/index.ts`
- [ ] T024 [US3] Create pantry service `src/services/pantry.ts`: implement `upsertItem(item: PantryItemInput)` (query-then-create-or-patch pattern per `contracts/notion-schemas.md`), `listItems(): Promise<PantryItem[]>`, `deductByMeal(ingredients: Ingredient[])`, `setThreshold(name: string, qty: number, unit: IngredientUnit)`, `checkExpiry(): Promise<PantryItem[]>` (within 48 h), `checkThresholds(): Promise<PantryItem[]>` (qty ≤ minThreshold)
- [ ] T025 [US3] Create notifier service `src/services/notifier.ts`: implement `sendExpiryWarning(item: PantryItem, suggestionTitle: string)`, `sendRestockAlert(item: PantryItem)`, `sendMessage(text: string)` — all dispatch via `bot.telegram.sendMessage` to each whitelisted user ID; implement `runDailyChecks()` that calls `pantry.checkExpiry` and dispatches warnings (with recipe stub for now)
- [ ] T026 [US3] Extend Groq client `src/integrations/groq.ts`: implement `parseIntent(text: string): Promise<ParsedIntent>` returning `{ intent: 'add_pantry' | 'query_schedule' | 'skip_meal' | 'query_pantry' | 'unknown', params: Record<string, unknown> }` using `llama-3.3-70b-versatile`
- [ ] T027 [US3] Add `/addpantry` and `/pantry` command handlers in `src/bot/handlers/command.ts`; add free-form NL routing for `add_pantry` intent in `src/bot/handlers/query.ts`; create `query.ts` handler file and register `bot.on('text', queryHandler)` in `src/index.ts`; wire `runDailyChecks` on a `setInterval` (every 6 h) in `src/index.ts`

**Checkpoint**: US3 fully functional — pantry CRUD via bot, expiry warnings firing

---

## Phase 5: User Story 1 — Chat-Based Meal Schedule Management (Priority: P1)

**Goal**: Answer schedule queries and accept meal plan adjustments via natural language

**Independent Test**: "What's for dinner on Friday?" → correct meal name returned; "Skip
Tuesday lunch" → bot confirms, entry marked skipped in Notion Meal Plan database

### Tests for User Story 1 ⚠️ (Write FIRST — must FAIL before implementation)

- [ ] T028 [P] [US1] Write unit tests for meal planner service in `tests/unit/meal-planner.test.ts`: mock notionClient; test createEntry (duplicate date+type rejected), getByDate, skipMeal (status → skipped), markConsumed (triggers deduct callback)

### Implementation for User Story 1

- [ ] T029 [P] [US1] Create `MealEntry`, `MealType`, `MealStatus` Zod schemas and TypeScript types in `src/models/meal-plan.ts`; update `src/models/index.ts`
- [ ] T030 [US1] Create meal planner service `src/services/meal-planner.ts`: implement `createEntry(entry: MealEntryInput)`, `getByDate(date: string): Promise<MealEntry[]>`, `getWeekPlan(from: string, days: number): Promise<MealEntry[]>`, `skipMeal(date: string, type: MealType): Promise<void>`, `markConsumed(id: string, onConsumed: (ingredients: Ingredient[]) => Promise<void>): Promise<void>` — call `pantry.deductByMeal` via the callback
- [ ] T031 [US1] Extend query handler `src/bot/handlers/query.ts`: route `query_schedule` intent → `mealPlanner.getByDate` / `getWeekPlan` → format and reply; route `skip_meal` intent → `mealPlanner.skipMeal` → confirm reply
- [ ] T032 [US1] Add `/plan [date]`, `/addmeal <date> <type> <recipe>`, `/skip <date> <type>` command handlers in `src/bot/handlers/command.ts`; register in `src/index.ts`
- [ ] T033 [US1] Connect `markConsumed` flow: add `/eaten <date> <type>` command that calls `mealPlanner.markConsumed` and sends "✅ {meal_type} marked as done. Pantry updated." notification

**Checkpoint**: US1 fully functional — schedule queries and plan adjustments via chat

---

## Phase 6: User Story 5 — Dynamic Cascade Portion Recalculation (Priority: P5)

**Goal**: When a meal is skipped or servings change, downstream ingredient quantities adjust

**Independent Test**: Skip a 4-person dinner → pantry quantities for that meal's ingredients
are restored; generate grocery list → reflects reduced requirements

### Tests for User Story 5 ⚠️ (Write FIRST — must FAIL before implementation)

- [ ] T034 [P] [US5] Extend `tests/unit/meal-planner.test.ts` with cascade tests: test that skipping a meal calls `pantry.restoreBySkippedMeal` with correct ingredients; test servings change recalculates delta correctly

### Implementation for User Story 5

- [ ] T035 [US5] Add `restoreBySkippedMeal(ingredients: Ingredient[])` to pantry service `src/services/pantry.ts`: reverse the ingredient deduction (add back to stock quantities)
- [ ] T036 [US5] Extend `mealPlanner.skipMeal` in `src/services/meal-planner.ts` to call `pantry.restoreBySkippedMeal` with the skipped meal's recipe ingredients (fetch recipe from Notion before skip)
- [ ] T037 [US5] Add `updateServings(id: string, newServings: number)` to `src/services/meal-planner.ts`: compute ingredient delta from old vs new servings; call `pantry.upsertItem` with delta to adjust stock; update MealEntry `Servings` in Notion
- [ ] T038 [US5] Add `/servings <date> <type> <n>` command in `src/bot/handlers/command.ts` that calls `mealPlanner.updateServings` and replies with updated quantities

**Checkpoint**: US5 functional — skip and servings-change cascade through pantry correctly

---

## Phase 7: User Story 4 — Automated Grocery List & Restock Alerts (Priority: P4)

**Goal**: Generate shopping list from meal plan vs pantry gap; send restock alerts on low stock

**Independent Test**: Set up plan with known gaps → `/groceries` returns exactly the missing
items with correct shortfall quantities and no duplicates

### Tests for User Story 4 ⚠️ (Write FIRST — must FAIL before implementation)

- [ ] T039 [P] [US4] Write unit tests for grocery list service in `tests/unit/grocery-list.test.ts`: mock mealPlanner and pantry services; test that shortfall is calculated correctly, zero-shortfall items are excluded, unit-mismatched items are treated as separate line items

### Implementation for User Story 4

- [ ] T040 [P] [US4] Create `GroceryItem` type in `src/models/grocery-list.ts`; update `src/models/index.ts`
- [ ] T041 [US4] Create grocery list service `src/services/grocery-list.ts`: implement `generate(): Promise<GroceryItem[]>` — fetch upcoming MealEntries within horizon, aggregate ingredient requirements per recipe servings, fetch current PantryItems, compute shortfall (required - stock), return items where shortfall > 0
- [ ] T042 [US4] Wire threshold alerts into pantry upsert: after every `pantry.upsertItem` call, invoke `notifier.checkThresholds` and dispatch restock alerts for any newly-below-threshold items in `src/services/pantry.ts`
- [ ] T043 [US4] Add `/groceries` command in `src/bot/handlers/command.ts`: call `groceryList.generate()`, format as bulleted list grouped by unit; add `/setthreshold <item> <qty> <unit>` command calling `pantry.setThreshold`; register both in `src/index.ts`

**Checkpoint**: US4 functional — grocery list generated on demand, restock alerts firing

---

## Phase 8: User Story 6 — Nutritional Macro & Kcal Balancing (Priority: P6 — Nice-to-Have)

**Goal**: Fetch macro data per ingredient; surface per-meal nutritional breakdown via chat

**Independent Test**: "What are the macros for tonight's dinner?" → bot replies with
calories, protein, carbs, fat per serving for that meal's recipe

### Tests for User Story 6 ⚠️ (Write FIRST — must FAIL before implementation)

- [ ] T044 [P] [US6] Write unit tests for nutrition service in `tests/unit/nutrition.test.ts`: mock nutrition API client; test macro aggregation across ingredients, null handling when API has no data for an ingredient, per-serving calculation

### Implementation for User Story 6

- [ ] T045 [P] [US6] Extend `RecipeSchema` in `src/models/recipe.ts` with optional `macros` field: `{ kcal: number, proteinG: number, carbsG: number, fatG: number } | undefined`
- [ ] T046 [P] [US6] Create nutrition API client `src/integrations/nutrition.ts`: implement `fetchMacros(ingredientName: string, quantity: number, unit: IngredientUnit): Promise<Macros | null>` — try Edamam API first (`EDAMAM_APP_ID`, `EDAMAM_APP_KEY` env vars), fall back to Open Food Facts API; return null on miss; add both keys to `.env.example`
- [ ] T047 [US6] Create nutrition service `src/services/nutrition.ts`: implement `calculateMealMacros(recipe: Recipe, servings: number): Promise<Macros>` — fetch macros per ingredient via `nutritionClient`, sum totals, divide by servings; cache results on the Recipe's `macros` field in Notion on first fetch
- [ ] T048 [US6] Extend query handler `src/bot/handlers/query.ts` and Groq intent parser to handle macro query intent; format and reply with per-serving breakdown

**Checkpoint**: US6 functional — macro queries answered via chat

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Production readiness, logging, documentation, and final validation

- [ ] T049 [P] Add `/help` command listing all available commands and `/start` welcome message in `src/bot/handlers/command.ts`
- [ ] T050 [P] Add structured console logging to all services and handlers: prefix logs with `[service-name]`, use `error`/`warn`/`info`/`debug` levels, never log API keys or user message content
- [ ] T051 Create `Dockerfile` at repo root: `FROM node:20-alpine`, copy `package.json` + `tsconfig.json`, run `npm ci`, copy `src/`, run `npm run build`, `CMD ["node", "dist/index.js"]`; add `.dockerignore`
- [ ] T052 [P] Write integration tests for Notion client in `tests/integration/notion.test.ts` (mock HTTP layer; test throttle behaviour, retry on 429, upsert pattern) and for Groq client in `tests/integration/groq.test.ts` (mock responses; test intent parsing, JSON repair)
- [ ] T053 Run `quickstart.md` validation: set up all three Notion databases per `contracts/notion-schemas.md`, configure `.env`, run `npm run dev`, send a test cookbook photo, verify Notion entry; fix any gaps found

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user stories**
- **US2 (Phase 3)**: Depends on Foundational — first story, unlocks recipe library
- **US3 (Phase 4)**: Depends on Foundational — can start in parallel with US2 (different files)
- **US1 (Phase 5)**: Depends on Foundational; benefits from US2 (recipes needed for plan)
- **US5 (Phase 6)**: Depends on US1 + US3 (needs both meal plan and pantry service)
- **US4 (Phase 7)**: Depends on US3 + US1 (needs pantry and meal plan services)
- **US6 (Phase 8)**: Depends on US2 (needs Recipe model with macros field)
- **Polish (Phase N)**: Depends on all desired user stories complete

### Within Each User Story

- Tests MUST be written first and FAIL before implementation begins
- Models before services
- Services before handlers
- Handlers before registration in `src/index.ts`

### Parallel Opportunities

- T002, T003, T005 can run in parallel with T001 (different files)
- T008, T009, T010, T011 can run in parallel after T007
- T013, T014 (tests + Gemini client) can run in parallel — different files
- T015, T016 (model + Gemini client) can run in parallel after tests are written
- US2 and US3 can be developed in parallel by two developers once Phase 2 is complete

---

## Parallel Example: User Story 2

```bash
# Write tests + create model + Gemini client all in parallel (different files):
Task: T013 — tests/unit/recipe-scanner.test.ts
Task: T014 — tests/integration/gemini.test.ts
Task: T015 — src/models/recipe.ts
Task: T016 — src/integrations/gemini.ts
```

---

## Implementation Strategy

### MVP First (US2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US2 (recipe scanner)
4. **STOP and VALIDATE**: Send a cookbook photo → Notion recipe entry appears
5. Demo to family — recipe gallery now visible in Notion

### Incremental Delivery

1. Setup + Foundational → bot starts, auth works
2. US2 → recipe scanning works, recipe gallery populated
3. US3 → pantry tracked, expiry warnings sent
4. US1 → meal schedule queries and adjustments via chat
5. US5 → skipping meals cascades correctly
6. US4 → grocery list on demand, restock alerts
7. US6 (optional) → macro queries

---

## Notes

- `[P]` tasks = different files, no shared state dependencies
- `[Story]` label maps each task to its spec.md user story for traceability
- Constitution mandates TDD: tests MUST be written and FAILING before implementation
- Commit after each user story checkpoint
- Verify Notion database property names match `contracts/notion-schemas.md` exactly before first write
- Do not log API keys, Telegram user IDs, or message content

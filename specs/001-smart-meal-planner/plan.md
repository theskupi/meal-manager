# Implementation Plan: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Branch**: `portion-recalculation` | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-smart-meal-planner/spec.md`

## Summary

A family-facing Telegram bot that automates meal planning, recipe ingestion from cookbook
photos (AI vision), pantry inventory tracking, grocery list generation, and cascade portion
recalculation. All user interactions flow through natural language Telegram commands.
Notion serves as the shared read-only family dashboard (recipe gallery + meal calendar).

Technical approach: Node.js 20 + TypeScript (strict), telegraf v4 bot framework, Gemini
Flash for vision, Groq Llama-3 for NLP/JSON repair, Notion API as the primary datastore
(replacing a dedicated database in v1), Zod for schema validation at every integration
boundary.

## Technical Context

**Language/Version**: TypeScript 5.4 / Node.js 20 LTS

**Primary Dependencies**: telegraf ^4.16, @google/generative-ai ^0.21, groq-sdk ^0.9,
@notionhq/client ^2.2, zod ^3.23, dotenv ^16.4

**Storage**: Notion API — three databases: Recipes, PantryItems, MealPlan
(Notion page IDs as primary keys; `ingredients[]` and `steps[]` stored as serialised JSON
in rich-text properties)

**Testing**: Jest ^29 + ts-jest ^29; unit tests in `tests/unit/`, integration tests in
`tests/integration/` (each external API boundary has a dedicated integration test)

**Target Platform**: Linux server (Node.js 20+); development mode uses long-polling,
production switches to Telegram webhook (HTTPS required)

**Project Type**: Telegram bot service (event-driven, single-process)

**Performance Goals**:

- Meal schedule query response via chat: ≤ 5 s
- Plan adjustment reflected on dashboard: ≤ 10 s
- Recipe extraction from photo: ≤ 30 s
- `/generatemenu` full lunch plan + grocery gap: ≤ 30 s
- Restock notification after threshold breach: ≤ 5 min

**Constraints**:

- Notion API: 3 req/s hard limit → throttled to 2.5 req/s with exponential backoff
- Groq free tier: 6 000 req/day, 30 req/min (Llama-3.3-70b)
- Gemini Flash free tier: 15 req/min, 1 M tokens/day
- No offline mode; no multi-tenant support in v1

**Scale/Scope**: Single family household; ~5–10 Telegram messages/day; 6 user stories
(US1–US6) spanning 8 implementation phases

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                        | Status  | Evidence                                                                                                                                                   |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. TypeScript-Strict Backend     | ✅ PASS | `tsconfig.json`: `"strict": true`; no `.js` files in `src/`; `any` prohibited                                                                              |
| II. AI-First Data Processing     | ✅ PASS | Gemini Flash for vision (photo→recipe); Groq Llama-3 for NLP intent parsing and JSON repair; no manual parsing pipelines                                   |
| III. External API Abstraction    | ✅ PASS | All integrations encapsulated in `src/integrations/` (notion.ts, telegram.ts, gemini.ts, groq.ts); credentials from env vars only                          |
| IV. Real-Time Inventory Accuracy | ✅ PASS | Pantry deducted on `consumed` event; cascade recalculation on skip/reschedule; restock alert on `quantity ≤ minThreshold`; stale-read guard (24 h) planned |
| V. Conversational-First UX       | ✅ PASS | All operations accessible via Telegram natural language; Notion is read-only family view; no new UX surface added without Telegram equivalent              |

**Post-design re-check**: ✅ All five principles upheld in data-model.md and contracts/.
No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-smart-meal-planner/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — technology decisions and rationale
├── data-model.md        # Phase 1 output — entity definitions and Notion property mapping
├── quickstart.md        # Phase 1 output — setup and smoke-test guide
├── contracts/
│   ├── telegram-commands.md        # Telegram command and NLP contract
│   ├── gemini-recipe-extraction.md # Gemini prompt and response schema contract
│   └── notion-schemas.md           # Notion database property definitions
└── tasks.md             # /speckit.tasks output — dependency-ordered implementation tasks
```

### Source Code (repository root)

```text
src/
├── bot/
│   ├── handlers/        # Telegram message/command handler functions
│   └── middleware/      # auth.ts — user ID whitelist enforcement
├── config/
│   └── index.ts         # Typed env-var loader; throws on missing required vars
├── integrations/
│   ├── index.ts         # Barrel re-exports
│   ├── notion.ts        # Notion API client with rate-limit throttle + backoff
│   ├── telegram.ts      # Telegraf bot instance + webhook helper
│   ├── gemini.ts        # Gemini Flash vision client
│   └── groq.ts          # Groq Llama-3 NLP client
├── models/
│   ├── index.ts         # Barrel re-exports
│   ├── recipe.ts        # RecipeSchema (Zod) + Recipe type
│   ├── pantry-item.ts   # PantryItemSchema (Zod) + PantryItem type
│   └── meal-plan.ts     # MealEntrySchema (Zod) + MealEntry type
├── services/
│   ├── recipe-scanner.ts   # Photo → Gemini → Zod → Notion write
│   ├── recipe-store.ts     # Recipe CRUD against Notion Recipes DB
│   ├── pantry.ts           # PantryItem CRUD + expiry check + deduction
│   ├── meal-planner.ts     # MealEntry CRUD + cascade recalculation + /generatemenu
│   ├── grocery-list.ts     # GroceryItem diff: meal plan requirements vs pantry stock
│   └── notifier.ts         # Fire-and-forget Telegram notification dispatcher
└── index.ts             # Entry point: apply middleware, register handlers, launch bot

tests/
├── unit/
│   ├── meal-planner.test.ts
│   └── pantry.test.ts
└── integration/
    └── gemini.test.ts
```

**Structure Decision**: Single-project layout (Option 1). No frontend; Notion provides the
family dashboard. All source under `src/`, compiled output to `dist/`. Test projects
separated by `jest.config.ts` patterns.

## Complexity Tracking

> No Constitution Check violations — this section is intentionally blank.

# Implementation Plan: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Branch**: `001-smart-meal-planner` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-smart-meal-planner/spec.md`

## Summary

A Node.js/TypeScript backend service that connects a Telegram bot (primary UX) with a Notion
workspace (family dashboard). The implementation is phased: first establishing the Gemini API
vision pipeline and Telegram integration to enable AI recipe ingestion, then layering pantry
management, meal planning, and grocery automation on top of the same integration foundation.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 LTS

**Primary Dependencies**:

- `telegraf` v4 — Telegram bot framework (TypeScript-native, middleware support)
- `@google/generative-ai` v0.21+ — Gemini API SDK for vision and text
- `groq-sdk` — Groq/Llama-3 for NLP intent parsing and JSON schema enforcement
- `@notionhq/client` v2.x — Notion API SDK (acts as the v1 datastore)
- `zod` — Runtime schema validation at all API integration boundaries
- `dotenv` — Environment variable management for local development

**Storage**: Notion API (databases for Recipes, PantryItems, MealPlan entries). No separate
database for v1. Notion API rate limit: 3 req/s — batch writes required for bulk operations.

**Testing**: Jest + ts-jest; unit tests for all service layer functions; integration tests for
each external API boundary using mock adapters.

**Target Platform**: Node.js server (Linux, Docker-compatible). Long-polling in development;
webhook mode (HTTPS) in production.

**Project Type**: Backend service (bot + multi-API orchestration)

**Performance Goals**: Recipe photo → structured Notion entry within 30 s; chat response
acknowledgement within 2 s; full natural language query response within 5 s.

**Constraints**: Gemini Flash free tier: 15 req/min — graceful queuing required. Telegram
file download size limit: 20 MB. Notion API: 3 req/s — writes must be batched or throttled.

**Scale/Scope**: Single family household (~5 Telegram users). ~100 recipes, ~200 pantry items,
5-day rolling meal plan window (default), max 31-day horizon.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                        | Status  | Notes                                                                                                 |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| I. TypeScript-Strict Backend     | ✅ PASS | `strict: true` in `tsconfig.json`; all modules typed                                                  |
| II. AI-First Data Processing     | ✅ PASS | Gemini Flash for vision (primary); Groq Llama-3 for NLP; no manual parsing pipelines                  |
| III. External API Abstraction    | ✅ PASS | All 6 services encapsulated in `src/integrations/`; credentials via env vars; mock adapters for tests |
| IV. Real-Time Inventory Accuracy | ✅ PASS | Pantry updates on every meal event; cascade recalc on plan changes; 24 h staleness check              |
| V. Conversational-First UX       | ✅ PASS | Telegram is sole mutation surface; Notion is read-only family view                                    |

**Post-Phase 1 re-check**: All gates still pass after data-model and contract design.

## Project Structure

### Documentation (this feature)

```text
specs/001-smart-meal-planner/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── telegram-commands.md
│   ├── notion-schemas.md
│   └── gemini-recipe-extraction.md
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── integrations/
│   ├── gemini.ts          # Gemini API client (vision + text)
│   ├── groq.ts            # Groq/Llama-3 client (NLP + JSON enforcement)
│   ├── telegram.ts        # Telegraf bot setup and exports
│   ├── notion.ts          # Notion API client wrapper
│   └── index.ts           # Re-exports all integration clients
├── models/
│   ├── recipe.ts          # Recipe + Ingredient types + Zod schemas
│   ├── pantry-item.ts     # PantryItem type + Zod schema
│   ├── meal-plan.ts       # MealPlan + MealEntry types + Zod schemas
│   ├── grocery-list.ts    # GroceryList + GroceryItem types
│   └── index.ts
├── services/
│   ├── recipe-scanner.ts  # Photo → Gemini → validated Recipe
│   ├── recipe-store.ts    # Recipe CRUD via Notion API
│   ├── pantry.ts          # PantryItem CRUD + expiry checks
│   ├── meal-planner.ts    # MealPlan management + cascade recalc
│   ├── grocery-list.ts    # Diff meal plan vs pantry → GroceryList
│   └── notifier.ts        # Restock and expiry notification dispatch
├── bot/
│   ├── handlers/
│   │   ├── photo.ts       # Handles incoming cookbook photos
│   │   ├── query.ts       # Handles NL schedule queries
│   │   └── command.ts     # Handles explicit /commands
│   └── middleware/
│       └── auth.ts        # Telegram user ID whitelist enforcement
├── config/
│   └── index.ts           # Typed env var config (all secrets here)
└── index.ts               # Bot startup + graceful shutdown

tests/
├── integration/
│   ├── gemini.test.ts
│   ├── groq.test.ts
│   ├── notion.test.ts
│   └── telegram.test.ts
└── unit/
    ├── recipe-scanner.test.ts
    ├── pantry.test.ts
    ├── meal-planner.test.ts
    └── grocery-list.test.ts
```

**Structure Decision**: Single Node.js backend service. No frontend — Notion handles the
family-facing read view; Telegram handles all user interaction. All external service clients
live in `src/integrations/`, all business logic in `src/services/`, bot event routing in
`src/bot/`.

## Complexity Tracking

> No constitution violations to justify.

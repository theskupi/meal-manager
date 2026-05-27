<!--
## Sync Impact Report

**Version Change**: N/A → 1.0.0 (initial ratification)

**Added Sections**:
- Core Principles (I–V): TypeScript-Strict Backend, AI-First Data Processing,
  External API Abstraction, Real-Time Inventory Accuracy, Conversational-First UX
- External Service Standards
- Development Workflow Standards
- Governance

**Modified Principles**: N/A (initial creation)

**Removed Sections**: N/A (initial creation)

**Templates Requiring Updates**:
- `.specify/templates/plan-template.md` ✅ reviewed — Constitution Check section present; no updates needed
- `.specify/templates/spec-template.md` ✅ reviewed — aligns with project requirements; no updates needed
- `.specify/templates/tasks-template.md` ✅ reviewed — aligns with development workflow standards; no updates needed

**Deferred TODOs**: None
-->

# Smart Meal Planner & Automated Kitchen Assistant Constitution

## Core Principles

### I. TypeScript-Strict Backend

All backend code MUST be written in TypeScript with `strict: true` enabled in `tsconfig.json`.
Node.js is the exclusive runtime. All module boundaries MUST expose typed interfaces; `any` types
are prohibited except in third-party interop layers, where they MUST be explicitly cast and
documented. Untyped JavaScript files are not permitted in the `src/` tree.

### II. AI-First Data Processing

Structured data extraction from unstructured sources (cookbook images, natural language input)
MUST use LLM APIs — no manual parsing pipelines. Vision tasks (photo-to-recipe) MUST use
GPT-4o-mini or Google Gemini. Text processing and JSON schema enforcement MUST use Groq (Llama 3)
as the default for cost efficiency. Fallback to a secondary LLM is permitted only when the primary
is unavailable; the fallback MUST be documented in the service layer.

### III. External API Abstraction

Every external service integration (Notion API, Telegram Bot API, Groq API, OpenAI API, Google
Gemini API) MUST be encapsulated behind a dedicated, typed
service interface in `src/integrations/`. API credentials MUST be loaded exclusively from
environment variables — hardcoded keys are prohibited. Each integration service MUST be
independently testable via dependency injection with mock adapters.

### IV. Real-Time Inventory Accuracy

The pantry inventory is the single source of truth for all meal planning decisions. Inventory
state MUST be updated after every relevant event: meal consumed, ingredients added, or items
expire. Portion cascade recalculation MUST execute automatically when any meal-plan schedule
changes. Automated restock alerts MUST fire when any tracked ingredient falls at or below its
defined minimum threshold. Stale inventory reads older than 24 hours MUST trigger a re-sync
warning.

### V. Conversational-First UX

The Telegram Bot is the primary human–computer interaction channel. Every user-facing operation
(query, adjust, add ingredient) MUST be accessible via natural language commands through the bot.
The Notion workspace MUST serve as the shared family read-view (calendar, recipes, shopping list)
and MUST NOT be the primary mutation interface. New UX surfaces MUST NOT be introduced without a
corresponding Telegram command equivalent.

## External Service Standards

All external API calls MUST implement exponential backoff with a maximum of 3 retries. Rate
limits for each provider MUST be tracked and respected; the system MUST degrade gracefully
(returning cached or partial data) rather than surfacing raw API errors to end users. API
response schemas MUST be validated against TypeScript types at the integration boundary.
Breaking changes to any external API contract MUST trigger an integration test failure and
block deployment.

Approved external services:

- **Notion API** — family dashboard and recipe gallery
- **Telegram Bot API** — primary chat interface and notifications
- **Groq API (Llama 3)** — text processing, NLP, and JSON schema enforcement
- **OpenAI API (GPT-4o-mini)** — multi-modal vision (cookbook photo parsing)
- **Google Gemini API** — fallback multi-modal vision

## Development Workflow Standards

Features MUST follow the Spec Kit workflow: specify → plan → tasks → implement. Each feature
MUST be developed on a dedicated branch following the `###-feature-name` convention. No direct
commits to `main` are permitted. All PRs MUST include a Constitution Check section confirming
compliance with all five Core Principles before merge.

Unit tests are REQUIRED for all service-layer functions. Integration tests are REQUIRED for each
external API boundary. Tests MUST be written before implementation (TDD). A failing test suite
MUST block any merge to `main`.

## Governance

This constitution supersedes all other project practices and informal conventions. All
contributors MUST read and acknowledge this document before making contributions.

**Amendment Process**: Amendments require a documented justification, a version bump per semantic
versioning rules (MAJOR for principle removal or redefinition, MINOR for additions, PATCH for
clarifications), and update of this document via the `/speckit.constitution` workflow.

**Compliance Review**: Every PR MUST include a Constitution Check section in the plan, verifying
adherence to all five Core Principles. Non-compliant PRs MUST NOT be merged without documented
exceptions in the Complexity Tracking section of the plan.

**Version Policy**: MAJOR.MINOR.PATCH — bumped per semantic versioning rules defined in the
`/speckit.constitution` workflow.

**Version**: 1.0.0 | **Ratified**: 2026-05-22 | **Last Amended**: 2026-05-22

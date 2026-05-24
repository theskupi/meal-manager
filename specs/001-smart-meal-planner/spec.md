# Feature Specification: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Feature Branch**: `001-smart-meal-planner`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "Use the information in README.md to create specification."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Chat-Based Meal Schedule Management (Priority: P1)

A family member opens their phone, sends a message to the family chat bot asking "What's for
dinner tomorrow?", and instantly receives the planned meal. They can also say "Skip lunch on
Thursday — we're eating out" and the plan adjusts automatically. All plan interactions happen
through natural language in the chat interface.

**Why this priority**: This is the primary UX layer for the entire system. Without a working
chat interface, no other feature is accessible to end users. It delivers immediate value even
before AI ingestion or inventory features are in place.

**Independent Test**: Can be fully tested by sending queries and adjustment commands to the chat
bot and verifying correct responses and updated calendar entries on the family dashboard.

**Acceptance Scenarios**:

1. **Given** a meal plan exists for the week, **When** a family member sends "What's for dinner
   on Friday?", **Then** the chat bot replies with the correct meal name and time within 5
   seconds.
2. **Given** a meal plan exists, **When** a user says "Skip Tuesday lunch", **Then** the chat
   bot confirms the change, removes Tuesday lunch from the plan, and the family dashboard
   reflects the update within 10 seconds.
3. **Given** no meal is planned for a requested day, **When** a user queries that day,
   **Then** the chat bot responds with a friendly "nothing planned" message.

---

### User Story 2 - AI Recipe Ingestion from Cookbook Photos (Priority: P2)

A family member snaps a photo of a cookbook page through the chat interface. Within seconds, the
recipe — including the ingredient list, structured step-by-step instructions, and portion metrics
— appears as a new entry in the family recipe gallery on the dashboard.

**Why this priority**: This is the primary method of building the recipe library. Without
recipes, the meal plan cannot be populated. It is the main input pipeline for the system.

**Independent Test**: Can be fully tested by submitting a cookbook photo via the chat interface
and verifying the resulting recipe entry in the dashboard contains correct ingredients and steps.

**Acceptance Scenarios**:

1. **Given** a user sends a clear cookbook photo, **When** the system processes it, **Then** a
   structured recipe with title, ingredients, and steps is created in the recipe gallery within
   30 seconds.
2. **Given** an ambiguous or low-quality photo, **When** the system cannot extract a complete
   recipe, **Then** the chat bot informs the user of the failure and requests a clearer photo.
3. **Given** a recipe was successfully ingested, **When** a user views the recipe gallery on
   the dashboard, **Then** the new recipe is visible with correct ingredient quantities and units.

---

### User Story 3 - Pantry Inventory Tracking & Expiry Management (Priority: P3)

A family member adds newly bought groceries to the system via the chat interface. The system
tracks quantities and expiry dates. When ingredients are about to expire, the system proactively
suggests a recipe that uses those items so nothing goes to waste.

**Why this priority**: Accurate pantry data is the foundation of grocery automation and waste
reduction. It enables US4 (grocery lists) and adds a "leftovers" intelligence layer.

**Independent Test**: Can be fully tested by adding pantry items, simulating approaching expiry
dates, and verifying the system surfaces a recipe suggestion via the chat bot.

**Acceptance Scenarios**:

1. **Given** a user sends "I bought 500g chicken breast, best before May 30" via chat,
   **When** the system processes the message, **Then** the pantry inventory is updated with
   the correct item, quantity, and expiry date.
2. **Given** an ingredient's expiry is within 2 days, **When** the daily check runs, **Then**
   the chat bot proactively sends a recipe suggestion that uses the expiring ingredient.
3. **Given** a meal is consumed and marked as eaten, **When** the event is recorded, **Then**
   the ingredient quantities used in that meal are deducted from pantry stock automatically.

---

### User Story 4 - Automated Grocery List & Restock Alerts (Priority: P4)

At the start of each week, the system compares the upcoming meal plan's ingredient requirements
against current pantry stock and generates an optimized shopping list. When any tracked essential
drops below a minimum stock level, the system sends an immediate restock alert to the family.

**Why this priority**: Eliminates manual grocery planning and prevents forgotten essentials. It
depends on US2 (recipe library) and US3 (pantry tracking) being in place.

**Independent Test**: Can be fully tested by setting up a meal plan with known ingredient
requirements, configuring pantry stock with deliberate gaps, and verifying the generated grocery
list contains exactly the missing items.

**Acceptance Scenarios**:

1. **Given** a weekly meal plan is set, **When** a user requests a grocery list, **Then** the
   system produces a shopping list containing only ingredients missing or insufficient in the
   pantry — no duplicates, no over-ordering.
2. **Given** an ingredient falls below its defined minimum threshold, **When** the threshold
   check runs, **Then** the chat bot sends a restock notification within 5 minutes.
3. **Given** items on the grocery list have been purchased and added to the pantry, **When**
   a new grocery list is generated, **Then** the purchased items no longer appear on the list.

---

### User Story 5 - Dynamic Meal Plan with Cascade Portion Recalculation (Priority: P5)

When a family member skips a meal, dines out, or changes the number of people eating, the system
automatically redistributes portions across the remaining meals in the plan so nutritional balance
and ingredient quantities remain accurate for the week.

**Why this priority**: Handles real-life plan deviations gracefully. Depends on a working meal
plan (US1) and pantry tracking (US3). Improves accuracy of grocery lists generated in US4.

**Independent Test**: Can be fully tested by modifying the number of servings for a planned meal
and verifying that related meals in the plan have their portions recalculated correctly.

**Acceptance Scenarios**:

1. **Given** a 4-person dinner is planned, **When** a user says "only 2 people eating dinner
   tonight", **Then** the system recalculates the ingredient quantities for that meal and
   updates the pantry deduction accordingly.
2. **Given** a meal is skipped entirely, **When** the skip is recorded, **Then** the system
   cascades the affected ingredients back to pantry stock and updates downstream grocery
   requirements.
3. **Given** multiple meals in a week depend on a shared ingredient, **When** one meal's
   portion changes, **Then** the total weekly requirement for that ingredient is recalculated
   and the grocery list reflects the new amount.

---

### Edge Cases

- What happens when the cookbook photo contains multiple recipes on the same page?
- What happens if a user sends conflicting plan changes in quick succession (race condition)?
- How does the chat bot behave when all external services are unavailable?
- What if an ingredient has no defined minimum threshold — does it still appear on the grocery
  list when stock reaches zero?
- How are unit mismatches handled (recipe uses "cups", pantry tracks "grams")?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST accept a photo sent through the chat interface and extract a
  structured recipe (title, ingredients with quantities, step-by-step instructions) using
  AI vision processing.
- **FR-002**: System MUST store extracted recipes in the family recipe gallery on the shared
  dashboard, viewable by all family members.
- **FR-003**: System MUST respond to natural language queries about the meal schedule (e.g.,
  "What's for dinner?") via the chat interface.
- **FR-004**: System MUST accept natural language instructions to adjust the meal plan (add,
  skip, or reschedule meals) via the chat interface.
- **FR-005**: System MUST maintain a pantry inventory with ingredient name, quantity, unit,
  and optional expiry date.
- **FR-006**: System MUST automatically deduct ingredients from pantry stock when a meal is
  marked as consumed.
- **FR-007**: System MUST generate a proactive recipe suggestion via the chat interface when
  any pantry ingredient's expiry date is within 48 hours.
- **FR-008**: System MUST generate a grocery shopping list by comparing weekly meal plan
  ingredient requirements against current pantry stock, containing only missing or
  insufficient items.
- **FR-009**: System MUST send a restock notification via the chat interface when any tracked
  ingredient falls at or below its defined minimum stock threshold.
- **FR-010**: System MUST automatically recalculate ingredient quantities and portions for
  remaining meals when a meal is skipped, rescheduled, or has its serving count changed.
- **FR-011**: System MUST display the weekly meal plan calendar and recipe gallery on the
  family dashboard in a read-only shared view.
- **FR-012**: System MUST allow family members to add ingredients to pantry inventory via
  natural language through the chat interface.
- **FR-013**: System MUST restrict chat bot access to authorised family members only via a
  Telegram user ID whitelist; messages from unlisted user IDs MUST be silently ignored.
- **FR-014**: The meal plan MUST support a configurable planning horizon with a default of
  5 days and a maximum of 31 days (1 month); the horizon MUST be adjustable by the
  family administrator without a system restart.

### Key Entities _(include if feature involves data)_

- **Recipe**: Represents a dish; has a title, ingredient list (with quantities and units),
  step-by-step preparation instructions, portion count, and optional photo reference.
- **Ingredient**: A named food item with quantity, unit of measurement, and optional expiry
  date. Exists both as a recipe component and as a pantry stock entry.
- **MealPlan**: A calendar-based schedule mapping meals (breakfast, lunch, dinner) to specific
  dates, serving counts, and linked recipes. Supports a configurable rolling horizon.
- **PantryItem**: Tracks current household stock of an ingredient: quantity on hand, unit,
  expiry date, and minimum restock threshold.
- **GroceryList**: A derived list of PantryItems that are missing or insufficient to fulfil
  the upcoming MealPlan; generated on demand or on a weekly schedule.
- **Notification**: A message sent to the family via the chat interface triggered by system
  events (expiry warning, restock alert, plan confirmation).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A cookbook photo submitted via chat results in a complete, structured recipe
  entry visible on the family dashboard within 30 seconds.
- **SC-002**: A natural language meal plan adjustment made via chat is reflected on the
  dashboard within 10 seconds.
- **SC-003**: The weekly grocery list covers 100% of ingredient gaps between the meal plan
  and current pantry stock, with no manual input required.
- **SC-004**: A restock notification is delivered to the family via chat within 5 minutes of
  an ingredient falling below its minimum threshold.
- **SC-005**: Pantry stock quantities are accurate (no drift) after 7 consecutive days of
  normal meal plan usage.
- **SC-006**: 90% of natural language queries about the meal schedule return a correct and
  complete answer on the first attempt.
- **SC-007**: Recipe suggestions for expiring ingredients are surfaced at least 48 hours
  before the expiry date with no missed alerts.

## Assumptions

- The system is used by a single family household; multi-family or multi-tenant support is
  out of scope for v1.
- Family members who do not use the chat interface can view the plan and recipes via the
  shared dashboard in read-only mode.
- Cookbook photos are in reasonably clear, well-lit conditions; the system is not required to
  handle severely degraded or partial images.
- Internet connectivity is available at all times; offline mode is out of scope for v1.
- The shared dashboard and chat platform accounts are already provisioned by the family
  administrator before first use.
- Recipes can only be added via photo ingestion or manual chat commands; importing from
  third-party recipe apps is out of scope for v1.

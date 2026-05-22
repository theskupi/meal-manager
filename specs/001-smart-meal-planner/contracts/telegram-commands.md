# Contract: Telegram Bot Commands

**Phase 1 Output** | **Date**: 2026-05-22 | **Plan**: [plan.md](../plan.md)

The Telegram bot accepts both explicit slash commands and free-form natural language
messages. All interactions are restricted to authorised user IDs (whitelist).

---

## Auth Behaviour

Every incoming message is checked against the whitelist before any handler runs.

| Condition | Bot response |
|-----------|-------------|
| User ID in whitelist | Process normally |
| User ID not in whitelist | Silently ignore (no reply) |

---

## Slash Commands

### `/start`
**Description**: Welcome message and feature overview.
**Arguments**: None
**Response**: Text message listing available commands.

---

### `/scan`
**Description**: Initiates recipe scanning mode. User should send a photo immediately after.
**Arguments**: None
**Response**: "Send me a photo of the cookbook page and I'll extract the recipe."

---

### `/recipes`
**Description**: Lists all recipes stored in the recipe gallery.
**Arguments**: Optional page number (e.g. `/recipes 2`)
**Response**: Paginated list of recipe titles with Notion page links. Page size: 10.

---

### `/addpantry <item> <quantity> <unit> [expiry: YYYY-MM-DD]`
**Description**: Adds or updates a pantry item.
**Example**: `/addpantry "chicken breast" 500 g expiry:2026-05-30`
**Response**: "✅ Added 500g chicken breast (expires 30 May)."
**Error**: "❌ Could not parse pantry item. Format: /addpantry <name> <qty> <unit> [expiry:YYYY-MM-DD]"

---

### `/pantry`
**Description**: Lists current pantry stock, sorted by expiry date (soonest first).
**Arguments**: None
**Response**: Formatted list of pantry items with quantity, unit, and expiry.

---

### `/plan [date: YYYY-MM-DD]`
**Description**: Shows the meal plan for today (default) or a specified date.
**Example**: `/plan 2026-05-25`
**Response**: Formatted meal plan for the requested date (breakfast / lunch / dinner).

---

### `/addmeal <date> <meal_type> <recipe_name>`
**Description**: Adds a recipe to the meal plan for a specific date and meal type.
**Example**: `/addmeal 2026-05-25 dinner "Chicken Tikka Masala"`
**Response**: "✅ Dinner on 25 May: Chicken Tikka Masala (4 servings)."
**Error**: "❌ Recipe not found. Use /recipes to browse available recipes."

---

### `/skip <date> <meal_type>`
**Description**: Marks a planned meal as skipped and triggers cascade recalculation.
**Example**: `/skip 2026-05-25 lunch`
**Response**: "✅ Lunch on 25 May skipped. Portions recalculated."

---

### `/groceries`
**Description**: Generates and returns the current grocery shopping list.
**Arguments**: None
**Response**: Formatted list of missing/insufficient ingredients for the upcoming plan window.

---

### `/setthreshold <item_name> <quantity> <unit>`
**Description**: Sets the minimum restock threshold for a pantry item.
**Example**: `/setthreshold "olive oil" 100 ml`
**Response**: "✅ Restock alert set: olive oil < 100ml."

---

### `/help`
**Description**: Lists all available commands with brief descriptions.
**Arguments**: None
**Response**: Formatted command reference.

---

## Photo Messages (No Command)

When a user sends a photo without any command:

**Trigger**: Any message with `message.photo` array present.
**Handler**: `src/bot/handlers/photo.ts`
**Flow**:
1. Bot immediately replies: "📸 Got it! Scanning recipe, please wait…"
2. Downloads highest-resolution photo from Telegram CDN.
3. Sends to Gemini Flash for structured extraction.
4. On success: "✅ Recipe saved: *{title}* ({n} ingredients). View it in Notion: {link}"
5. On extraction failure: "❌ Couldn't extract a recipe from this photo. Try a clearer image."
6. On Notion write failure: "❌ Recipe extracted but failed to save. Please try again."

---

## Free-Form Natural Language Messages

Any text message that is not a slash command is routed to the NLP handler.

**Handler**: `src/bot/handlers/query.ts`
**NLP engine**: Groq Llama-3

### Supported intents and example utterances

| Intent | Example utterances |
|--------|--------------------|
| `query_schedule` | "What's for dinner tomorrow?", "Show me the plan for this week" |
| `skip_meal` | "Skip lunch on Thursday", "We're eating out Friday dinner" |
| `add_pantry` | "I bought 1kg tomatoes", "Added 2 cans of chickpeas" |
| `query_pantry` | "Do we have enough pasta?", "What's expiring soon?" |
| `unknown` | Anything unrecognisable |

### Response for `unknown` intent
"Sorry, I didn't understand that. Type /help to see what I can do."

---

## Proactive Notifications (Bot-Initiated)

These are sent by `src/services/notifier.ts` without a user trigger.

| Notification | Trigger | Message format |
|-------------|---------|----------------|
| Expiry warning | Ingredient expires within 48 h | "⚠️ *{name}* expires on {date}. Try: {recipe suggestion}." |
| Restock alert | `quantity <= minThreshold` | "🛒 Low stock: *{name}* ({quantity}{unit} remaining)." |
| Plan confirmation | MealEntry status → `consumed` | "✅ {meal_type} marked as done. Pantry updated." |

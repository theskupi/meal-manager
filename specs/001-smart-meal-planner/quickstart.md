# Quickstart: Smart Meal Planner & Automated Kitchen Assistant (PapiPap)

**Phase 1 Output** | **Date**: 2026-05-22

---

## Prerequisites

- Node.js 20 LTS (`node -v` → `v20.x.x`)
- npm 9+ or pnpm 8+
- A Telegram account and a bot token (from [@BotFather](https://t.me/BotFather))
- A Google AI Studio account with a Gemini API key
- A Groq account with an API key
- A Notion account with an integration token and three databases set up (see below)

---

## Step 1: Clone and install dependencies

```bash
git clone <repo-url>
cd meal-manager
npm install
```

---

## Step 2: Set up Notion databases

Create three databases in your Notion workspace. For each one, add the properties exactly
as specified in `specs/001-smart-meal-planner/contracts/notion-schemas.md`.

**Important**: Pre-populate the `Unit` select options in the Pantry database and the
`Status` and `Meal Type` select options in the Meal Plan database before the bot starts,
otherwise the first write will fail.

To get a database ID: open the database in Notion → copy the URL → the ID is the 32-char
string between the last `/` and the `?` (e.g. `https://notion.so/workspace/DATABASE_ID?v=...`).

---

## Step 3: Create a Notion integration

1. Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Create a new internal integration → copy the **Internal Integration Token**.
3. Open each of your three databases → click **…** → **Connections** → add your integration.

---

## Step 4: Get your Telegram user ID

Send any message to [@userinfobot](https://t.me/userinfobot) on Telegram. It will reply
with your numeric user ID (e.g. `123456789`). Collect IDs for all family members who
should have bot access.

---

## Step 5: Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321

# Google Gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Groq
GROQ_API_KEY=your_groq_api_key_here

# Notion
NOTION_TOKEN=your_notion_integration_token_here
NOTION_RECIPES_DB_ID=your_recipes_database_id_here
NOTION_PANTRY_DB_ID=your_pantry_database_id_here
NOTION_MEAL_PLAN_DB_ID=your_meal_plan_database_id_here

# App config
PLAN_HORIZON_DAYS=5
PLAN_HORIZON_MAX_DAYS=31
NODE_ENV=development
```

---

## Step 6: Run in development mode

```bash
npm run dev
```

The bot starts in long-polling mode. Send `/start` from one of the authorised Telegram
accounts to verify the connection.

---

## Step 7: Smoke test — scan a recipe

1. Find a clear photo of a cookbook recipe page.
2. Send the photo to your bot in Telegram.
3. The bot should reply: "📸 Got your photo! Scanning for a recipe…"
4. The message is updated in-place: "⏳ Found _{RecipeName}_ — saving to Notion…"
5. Final message: "✅ _{RecipeName}_ saved!" with ingredient list and a Notion link.
6. Open your Notion Recipes database and verify the new entry.

---

## Running tests

```bash
# Unit tests only
npm test

# Unit tests with coverage report
npm run test:coverage

# Integration tests (mocked — no real API keys required)
npm run test:integration

# All tests
npm run test:all
```

---

## Production deployment

### Direct (Node.js)

1. Set `NODE_ENV=production` in your environment.
2. Set a public HTTPS webhook URL: `TELEGRAM_WEBHOOK_URL=https://yourdomain.com/bot`
3. Build: `npm run build`
4. Start: `npm start`

The bot will register its webhook with Telegram on startup and switch from polling to
webhook mode automatically.

### Docker

```bash
docker build -t papipap .
docker run -d --env-file .env papipap
```

The `Dockerfile` at the repo root builds a production image from `node:20-alpine`.
Pass environment variables via `--env-file .env` or your orchestrator's secret store.

---

## Troubleshooting

| Symptom                                       | Likely cause                       | Fix                                             |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| Bot ignores all messages                      | User ID not in whitelist           | Add your ID to `TELEGRAM_ALLOWED_USER_IDS`      |
| Recipe scan returns "Couldn't extract recipe" | Photo too dark / angled            | Retake with better lighting                     |
| Notion write fails with 400                   | Select option not pre-populated    | Add missing options in Notion database settings |
| Gemini 429 errors                             | Free tier rate limit hit           | Wait 1 minute; consider upgrading Gemini plan   |
| Bot not responding at all                     | Bot token invalid or polling error | Check `TELEGRAM_BOT_TOKEN` and restart          |

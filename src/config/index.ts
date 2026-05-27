import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalString(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseAllowedUserIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = parseInt(s, 10);
      if (isNaN(n))
        throw new Error(`Invalid Telegram user ID in TELEGRAM_ALLOWED_USER_IDS: "${s}"`);
      return n;
    });
}

export interface Config {
  telegram: {
    botToken: string;
    allowedUserIds: number[];
    webhookUrl: string | undefined;
  };
  gemini: {
    apiKey: string;
  };
  groq: {
    apiKey: string;
  };
  notion: {
    token: string;
    recipesDatabaseId: string;
    pantryDatabaseId: string;
    mealPlanDatabaseId: string;
  };
  app: {
    planHorizonDays: number;
    planHorizonMaxDays: number;
    householdSize: number;
    nodeEnv: string;
    isDevelopment: boolean;
    isProduction: boolean;
  };
}

function loadConfig(): Config {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  return {
    telegram: {
      botToken: required('TELEGRAM_BOT_TOKEN'),
      allowedUserIds: parseAllowedUserIds(required('TELEGRAM_ALLOWED_USER_IDS')),
      webhookUrl: optionalString('TELEGRAM_WEBHOOK_URL'),
    },
    gemini: {
      apiKey: required('GEMINI_API_KEY'),
    },
    groq: {
      apiKey: required('GROQ_API_KEY'),
    },
    notion: {
      token: required('NOTION_TOKEN'),
      recipesDatabaseId: required('NOTION_RECIPES_DB_ID'),
      pantryDatabaseId: required('NOTION_PANTRY_DB_ID'),
      mealPlanDatabaseId: required('NOTION_MEAL_PLAN_DB_ID'),
    },
    app: {
      planHorizonDays: optionalInt('PLAN_HORIZON_DAYS', 5),
      planHorizonMaxDays: optionalInt('PLAN_HORIZON_MAX_DAYS', 31),
      householdSize: optionalInt('HOUSEHOLD_SIZE', 2),
      nodeEnv,
      isDevelopment: nodeEnv !== 'production',
      isProduction: nodeEnv === 'production',
    },
  };
}

export const config = loadConfig();

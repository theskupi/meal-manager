jest.mock('../../src/config', () => ({
  config: {
    telegram: { botToken: 'test-token', allowedUserIds: [123456789], webhookUrl: undefined },
    gemini: { apiKey: 'test-gemini-key' },
    groq: { apiKey: 'test-groq-key' },
    notion: {
      token: 'test-notion-token',
      recipesDatabaseId: 'test-recipes-db',
      pantryDatabaseId: 'test-pantry-db',
      mealPlanDatabaseId: 'test-meal-plan-db',
    },
    app: {
      planHorizonDays: 5,
      planHorizonMaxDays: 31,
      nodeEnv: 'test',
      isDevelopment: true,
      isProduction: false,
      householdSize: 2,
    },
  },
}));

jest.mock('../../src/services/meal-planner', () => ({
  getWeekPlan: jest.fn(),
}));

jest.mock('../../src/services/pantry', () => ({
  listItems: jest.fn(),
}));

jest.mock('../../src/integrations/notion', () => ({
  notionClient: {
    pages: { retrieve: jest.fn() },
  },
  withRetry: jest.fn((fn: () => unknown) => fn()),
}));

import { getWeekPlan } from '../../src/services/meal-planner';
import { listItems } from '../../src/services/pantry';
import { notionClient } from '../../src/integrations/notion';
import { generate } from '../../src/services/grocery-list';
import { MealEntry } from '../../src/models/meal-plan';
import { PantryItem } from '../../src/models/pantry-item';

const mockGetWeekPlan = getWeekPlan as jest.Mock;
const mockListItems = listItems as jest.Mock;
const mockRetrieve = notionClient.pages.retrieve as jest.Mock;

function makeMealEntry(overrides: Partial<MealEntry> = {}): MealEntry {
  return {
    id: 'entry-1',
    date: '2026-05-25',
    mealType: 'dinner',
    recipeId: 'recipe-1',
    recipeTitle: 'Test Recipe',
    servings: 4,
    status: 'planned',
    ...overrides,
  };
}

function makePantryItem(name: string, quantity: number, unit: PantryItem['unit']): PantryItem {
  return {
    id: `pantry-${name}`,
    name,
    quantity,
    unit,
    updatedAt: new Date().toISOString(),
  };
}

function makeRecipePage(recipeId: string, ingredients: unknown[], servings = 4) {
  return {
    id: recipeId,
    object: 'page',
    properties: {
      Servings: { number: servings },
      Ingredients: { rich_text: [{ plain_text: JSON.stringify(ingredients) }] },
    },
  };
}

beforeEach(() => jest.clearAllMocks());

describe('generate', () => {
  it('calculates shortfall correctly for a single ingredient', async () => {
    mockGetWeekPlan.mockResolvedValueOnce([makeMealEntry()]);
    mockRetrieve.mockResolvedValueOnce(
      makeRecipePage('recipe-1', [{ name: 'chicken', quantity: 400, unit: 'g', notes: null }], 4),
    );
    mockListItems.mockResolvedValueOnce([makePantryItem('chicken', 100, 'g')]);

    const result = await generate();

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('chicken');
    expect(result[0]!.requiredQuantity).toBeCloseTo(400);
    expect(result[0]!.currentStock).toBe(100);
    expect(result[0]!.shortfallQuantity).toBeCloseTo(300);
    expect(result[0]!.unit).toBe('g');
  });

  it('excludes items where pantry stock meets or exceeds requirements', async () => {
    mockGetWeekPlan.mockResolvedValueOnce([makeMealEntry()]);
    mockRetrieve.mockResolvedValueOnce(
      makeRecipePage('recipe-1', [{ name: 'flour', quantity: 200, unit: 'g', notes: null }], 4),
    );
    mockListItems.mockResolvedValueOnce([makePantryItem('flour', 500, 'g')]);

    const result = await generate();

    expect(result).toHaveLength(0);
  });

  it('treats unit-mismatched items as separate line items', async () => {
    const entry1 = makeMealEntry({ id: 'e1', recipeId: 'recipe-1', servings: 4 });
    const entry2 = makeMealEntry({ id: 'e2', recipeId: 'recipe-2', servings: 4 });
    mockGetWeekPlan.mockResolvedValueOnce([entry1, entry2]);
    mockRetrieve
      .mockResolvedValueOnce(
        makeRecipePage('recipe-1', [{ name: 'milk', quantity: 500, unit: 'ml', notes: null }], 4),
      )
      .mockResolvedValueOnce(
        makeRecipePage('recipe-2', [{ name: 'milk', quantity: 2, unit: 'cup', notes: null }], 4),
      );
    mockListItems.mockResolvedValueOnce([]);

    const result = await generate();

    expect(result).toHaveLength(2);
    const units = result.map((r) => r.unit).sort();
    expect(units).toContain('ml');
    expect(units).toContain('cup');
  });

  it('skips meal entries with status skipped', async () => {
    mockGetWeekPlan.mockResolvedValueOnce([
      makeMealEntry({ status: 'skipped', recipeId: 'recipe-1' }),
    ]);
    mockListItems.mockResolvedValueOnce([]);

    const result = await generate();

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('skips meal entries with no recipeId', async () => {
    mockGetWeekPlan.mockResolvedValueOnce([makeMealEntry({ recipeId: undefined })]);
    mockListItems.mockResolvedValueOnce([]);

    const result = await generate();

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('falls back to default servings when recipe has 0 servings', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockGetWeekPlan.mockResolvedValueOnce([makeMealEntry({ servings: 4 })]);
    mockRetrieve.mockResolvedValueOnce(
      makeRecipePage('recipe-1', [{ name: 'rice', quantity: 200, unit: 'g', notes: null }], 0),
    );
    mockListItems.mockResolvedValueOnce([]);

    const result = await generate();

    // With 0 servings the fallback is 4, so scale = 4/4 = 1, quantity = 200
    expect(result).toHaveLength(1);
    expect(result[0]!.requiredQuantity).toBeCloseTo(200);
    expect(result[0]!.shortfallQuantity).toBeCloseTo(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid Servings value (0)'));
    warnSpy.mockRestore();
  });

  it('aggregates the same ingredient from multiple entries', async () => {
    const entry1 = makeMealEntry({ id: 'e1', recipeId: 'recipe-1', servings: 4 });
    const entry2 = makeMealEntry({ id: 'e2', recipeId: 'recipe-2', servings: 4 });
    mockGetWeekPlan.mockResolvedValueOnce([entry1, entry2]);
    mockRetrieve
      .mockResolvedValueOnce(
        makeRecipePage('recipe-1', [{ name: 'tomato', quantity: 200, unit: 'g', notes: null }], 4),
      )
      .mockResolvedValueOnce(
        makeRecipePage('recipe-2', [{ name: 'tomato', quantity: 150, unit: 'g', notes: null }], 4),
      );
    mockListItems.mockResolvedValueOnce([makePantryItem('tomato', 100, 'g')]);

    const result = await generate();

    expect(result).toHaveLength(1);
    expect(result[0]!.requiredQuantity).toBeCloseTo(350);
    expect(result[0]!.shortfallQuantity).toBeCloseTo(250);
  });
});

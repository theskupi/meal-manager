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
    },
  },
}));

jest.mock('../../src/integrations/notion', () => ({
  notionClient: {
    databases: { query: jest.fn() },
    pages: { create: jest.fn(), update: jest.fn() },
  },
  withRetry: jest.fn((fn: () => unknown) => fn()),
}));

import { notionClient } from '../../src/integrations/notion';
import {
  upsertItem,
  listItems,
  deductByMeal,
  checkExpiry,
  checkThresholds,
} from '../../src/services/pantry';
import { convertToUnit } from '../../src/models/recipe';

const mockQuery = notionClient.databases.query as jest.Mock;
const mockCreate = notionClient.pages.create as jest.Mock;
const mockUpdate = notionClient.pages.update as jest.Mock;

function makePage(
  id: string,
  name: string,
  quantity: number,
  unit: string,
  expiryDate?: string,
  minThreshold?: number,
) {
  return {
    id,
    object: 'page',
    last_edited_time: '2026-05-22T10:00:00.000Z',
    properties: {
      Name: { title: [{ plain_text: name }] },
      Quantity: { number: quantity },
      Unit: { select: { name: unit } },
      'Expiry Date': expiryDate ? { date: { start: expiryDate } } : { date: null },
      'Min Threshold': minThreshold !== undefined ? { number: minThreshold } : { number: null },
      'Last Updated': { last_edited_time: '2026-05-22T10:00:00.000Z' },
    },
  };
}

function emptyQueryResult() {
  return {
    results: [],
    next_cursor: null,
    has_more: false,
    object: 'list',
    type: 'page_or_database',
  };
}

function queryResult(...pages: ReturnType<typeof makePage>[]) {
  return {
    results: pages,
    next_cursor: null,
    has_more: false,
    object: 'list',
    type: 'page_or_database',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upsertItem', () => {
  it('creates a new pantry item when none exists', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());
    mockCreate.mockResolvedValueOnce(makePage('page-new', 'chicken breast', 500, 'g'));

    const result = await upsertItem({ name: 'chicken breast', quantity: 500, unit: 'g' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Name: { title: [{ text: { content: 'chicken breast' } }] },
          Quantity: { number: 500 },
          Unit: { select: { name: 'g' } },
        }),
      }),
    );
    expect(result.name).toBe('chicken breast');
    expect(result.quantity).toBe(500);
    expect(result.unit).toBe('g');
  });

  it('increments quantity on an existing item', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makePage('page-existing', 'chicken breast', 200, 'g')),
    );
    mockUpdate.mockResolvedValueOnce(makePage('page-existing', 'chicken breast', 500, 'g'));

    const result = await upsertItem({ name: 'chicken breast', quantity: 300, unit: 'g' });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-existing',
        properties: expect.objectContaining({
          Quantity: { number: 500 },
        }),
      }),
    );
    expect(result.quantity).toBe(500);
  });

  it('stores expiryDate when provided', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());
    mockCreate.mockResolvedValueOnce(makePage('page-new', 'milk', 1, 'l', '2026-05-30'));

    await upsertItem({ name: 'milk', quantity: 1, unit: 'l', expiryDate: '2026-05-30' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          'Expiry Date': { date: { start: '2026-05-30' } },
        }),
      }),
    );
  });
});

describe('listItems', () => {
  it('returns all pantry items sorted by expiry date', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(
        makePage('page-a', 'pasta', 400, 'g', '2026-06-01'),
        makePage('page-b', 'rice', 1000, 'g'),
      ),
    );

    const result = await listItems();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('pasta');
    expect(result[1].name).toBe('rice');
  });

  it('returns empty array when pantry is empty', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());

    const result = await listItems();

    expect(result).toHaveLength(0);
  });
});

describe('deductByMeal', () => {
  it('deducts ingredient quantities from matching pantry items', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-pasta', 'pasta', 500, 'g')));
    mockUpdate.mockResolvedValueOnce(makePage('page-pasta', 'pasta', 100, 'g'));

    await deductByMeal([{ name: 'pasta', quantity: 400, unit: 'g', notes: null }]);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-pasta',
        properties: expect.objectContaining({
          Quantity: { number: 100 },
        }),
      }),
    );
  });

  it('clamps quantity to 0 when deduction exceeds stock', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-salt', 'salt', 50, 'g')));
    mockUpdate.mockResolvedValueOnce(makePage('page-salt', 'salt', 0, 'g'));

    await deductByMeal([{ name: 'salt', quantity: 200, unit: 'g', notes: null }]);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Quantity: { number: 0 },
        }),
      }),
    );
  });

  it('skips ingredients not found in pantry', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());

    await deductByMeal([{ name: 'truffle oil', quantity: 10, unit: 'ml', notes: null }]);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('checkExpiry', () => {
  it('returns items that expire within 48 hours', async () => {
    const soonDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-milk', 'milk', 1, 'l', soonDate)));

    const result = await checkExpiry();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          property: 'Expiry Date',
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('milk');
    expect(result[0].expiryDate).toBe(soonDate);
  });

  it('returns empty array when no items are expiring soon', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());

    const result = await checkExpiry();

    expect(result).toHaveLength(0);
  });
});

describe('checkThresholds', () => {
  it('returns items where quantity is at or below minThreshold', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(
        makePage('page-oil', 'olive oil', 50, 'ml', undefined, 100),
        makePage('page-flour', 'flour', 100, 'g', undefined, 200),
        makePage('page-sugar', 'sugar', 1000, 'g', undefined, 500),
      ),
    );

    const result = await checkThresholds();

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.name)).toEqual(expect.arrayContaining(['olive oil', 'flour']));
  });

  it('returns empty array when all items are above threshold', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makePage('page-rice', 'rice', 2000, 'g', undefined, 500)),
    );

    const result = await checkThresholds();

    expect(result).toHaveLength(0);
  });

  it('returns items with no minThreshold set when listItems returns them', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-pepper', 'pepper', 10, 'g')));

    const result = await checkThresholds();

    expect(result).toHaveLength(0);
  });
});

describe('convertToUnit', () => {
  it('returns same value when units are equal', () => {
    expect(convertToUnit(500, 'g', 'g')).toBe(500);
    expect(convertToUnit(1, 'l', 'l')).toBe(1);
  });

  it('converts kg to g', () => {
    expect(convertToUnit(0.5, 'kg', 'g')).toBe(500);
  });

  it('converts g to kg', () => {
    expect(convertToUnit(1000, 'g', 'kg')).toBe(1);
  });

  it('converts l to ml', () => {
    expect(convertToUnit(1, 'l', 'ml')).toBe(1000);
  });

  it('converts ml to l', () => {
    expect(convertToUnit(500, 'ml', 'l')).toBe(0.5);
  });

  it('converts tbsp to ml', () => {
    expect(convertToUnit(2, 'tbsp', 'ml')).toBe(30);
  });

  it('converts cup to ml', () => {
    expect(convertToUnit(1, 'cup', 'ml')).toBe(240);
  });

  it('returns null for incompatible unit families (mass vs volume)', () => {
    expect(convertToUnit(100, 'g', 'ml')).toBeNull();
    expect(convertToUnit(1, 'l', 'kg')).toBeNull();
  });

  it('returns null for units with no conversion factor (piece, other)', () => {
    expect(convertToUnit(1, 'piece', 'g')).toBeNull();
    expect(convertToUnit(1, 'other', 'ml')).toBeNull();
  });
});

describe('upsertItem — mixed unit handling', () => {
  it('converts kg into g when existing item is stored in g (500 g + 0.5 kg = 1000 g)', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makePage('page-chicken', 'chicken breast', 500, 'g')),
    );
    mockUpdate.mockResolvedValueOnce(makePage('page-chicken', 'chicken breast', 1000, 'g'));

    const result = await upsertItem({ name: 'chicken breast', quantity: 0.5, unit: 'kg' });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-chicken',
        properties: expect.objectContaining({
          Quantity: { number: 1000 },
        }),
      }),
    );
    expect(result.unit).toBe('g');
    expect(result.quantity).toBe(1000);
  });

  it('does not overwrite the stored unit when adding a compatible unit', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-oil', 'olive oil', 200, 'ml')));
    mockUpdate.mockResolvedValueOnce(makePage('page-oil', 'olive oil', 215, 'ml'));

    await upsertItem({ name: 'olive oil', quantity: 1, unit: 'tbsp' });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Quantity: { number: 215 },
        }),
      }),
    );
    expect(mockUpdate.mock.calls[0][0].properties).not.toHaveProperty('Unit');
  });

  it('throws an error when units are incompatible (g vs ml)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-flour', 'flour', 500, 'g')));

    await expect(upsertItem({ name: 'flour', quantity: 100, unit: 'ml' })).rejects.toThrow(
      /unit mismatch/i,
    );
  });
});

describe('deductByMeal — mixed unit handling', () => {
  it('converts kg to g before deducting (1000 g pantry - 0.4 kg = 600 g)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-pasta', 'pasta', 1000, 'g')));
    mockUpdate.mockResolvedValueOnce(makePage('page-pasta', 'pasta', 600, 'g'));

    await deductByMeal([{ name: 'pasta', quantity: 0.4, unit: 'kg', notes: null }]);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Quantity: { number: 600 },
        }),
      }),
    );
  });

  it('skips ingredient with incompatible units and does not update', async () => {
    mockQuery.mockResolvedValueOnce(queryResult(makePage('page-sugar', 'sugar', 500, 'g')));

    await deductByMeal([{ name: 'sugar', quantity: 100, unit: 'ml', notes: null }]);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

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

jest.mock('../../src/services/pantry', () => ({
  restoreBySkippedMeal: jest.fn(),
  deductByMeal: jest.fn(),
}));

jest.mock('../../src/integrations/notion', () => ({
  notionClient: {
    databases: { query: jest.fn() },
    pages: { create: jest.fn(), update: jest.fn(), retrieve: jest.fn() },
  },
  withRetry: jest.fn((fn: () => unknown) => fn()),
}));

import { notionClient } from '../../src/integrations/notion';
import { restoreBySkippedMeal, deductByMeal } from '../../src/services/pantry';
import {
  createEntry,
  getByDate,
  skipMeal,
  markConsumed,
  updateServings,
} from '../../src/services/meal-planner';

const mockQuery = notionClient.databases.query as jest.Mock;
const mockCreate = notionClient.pages.create as jest.Mock;
const mockUpdate = notionClient.pages.update as jest.Mock;
const mockRetrieve = notionClient.pages.retrieve as jest.Mock;

function makeMealPage(
  id: string,
  date: string,
  mealType: string,
  recipeTitle: string,
  servings: number,
  status: string,
  recipeId?: string,
  notes?: string,
) {
  return {
    id,
    object: 'page',
    last_edited_time: '2026-05-22T10:00:00.000Z',
    properties: {
      Title: { title: [{ plain_text: `${date} ${mealType}` }] },
      Date: { date: { start: date } },
      'Meal Type': { select: { name: mealType } },
      'Recipe Title': { rich_text: [{ plain_text: recipeTitle }] },
      Servings: { number: servings },
      Status: { select: { name: status } },
      Recipe: { relation: recipeId ? [{ id: recipeId }] : [] },
      Notes: { rich_text: notes ? [{ plain_text: notes }] : [] },
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

function queryResult(...pages: ReturnType<typeof makeMealPage>[]) {
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

describe('createEntry', () => {
  it('creates a new meal entry when no duplicate exists', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());
    const newPage = makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 4, 'planned');
    mockCreate.mockResolvedValueOnce(newPage);

    const result = await createEntry({
      date: '2026-05-25',
      mealType: 'dinner',
      recipeTitle: 'Chicken Tikka',
      servings: 4,
      status: 'planned',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Date: { date: { start: '2026-05-25' } },
          'Meal Type': { select: { name: 'dinner' } },
        }),
      }),
    );
    expect(result.date).toBe('2026-05-25');
    expect(result.mealType).toBe('dinner');
    expect(result.recipeTitle).toBe('Chicken Tikka');
  });

  it('throws when a duplicate (date, mealType) already exists', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makeMealPage('entry-existing', '2026-05-25', 'dinner', 'Pizza', 4, 'planned')),
    );

    await expect(
      createEntry({
        date: '2026-05-25',
        mealType: 'dinner',
        recipeTitle: 'Chicken Tikka',
        servings: 4,
        status: 'planned',
      }),
    ).rejects.toThrow(/already exists/i);

    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('getByDate', () => {
  it('returns all meal entries for a given date', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(
        makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Oatmeal', 2, 'planned'),
        makeMealPage('entry-2', '2026-05-25', 'dinner', 'Pizza', 4, 'planned'),
      ),
    );

    const result = await getByDate('2026-05-25');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ property: 'Date' }),
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe('2026-05-25');
    expect(result[1]!.date).toBe('2026-05-25');
  });

  it('returns empty array when no entries exist for the date', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());

    const result = await getByDate('2026-05-25');

    expect(result).toHaveLength(0);
  });
});

describe('skipMeal', () => {
  it('updates the meal entry status to skipped', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makeMealPage('entry-1', '2026-05-25', 'lunch', 'Salad', 2, 'planned')),
    );
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'lunch', 'Salad', 2, 'skipped'),
    );

    await skipMeal('2026-05-25', 'lunch');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'entry-1',
        properties: expect.objectContaining({
          Status: { select: { name: 'skipped' } },
        }),
      }),
    );
  });

  it('throws when no meal entry exists for the date and type', async () => {
    mockQuery.mockResolvedValueOnce(emptyQueryResult());

    await expect(skipMeal('2026-05-25', 'lunch')).rejects.toThrow(/not found/i);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('skipMeal cascade', () => {
  it('calls restoreBySkippedMeal with recipe ingredients when recipe is linked', async () => {
    const recipeIngredients = [{ name: 'chicken', quantity: 200, unit: 'g', notes: null }];
    mockQuery.mockResolvedValueOnce(
      queryResult(
        makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 4, 'planned', 'recipe-1'),
      ),
    );
    const recipePage = {
      id: 'recipe-1',
      object: 'page',
      last_edited_time: '2026-05-22T10:00:00.000Z',
      properties: {
        Title: { title: [{ plain_text: 'Chicken Tikka' }] },
        Ingredients: { rich_text: [{ plain_text: JSON.stringify(recipeIngredients) }] },
        Servings: { number: 4 },
      },
    };
    mockRetrieve.mockResolvedValueOnce(recipePage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 4, 'skipped', 'recipe-1'),
    );
    (restoreBySkippedMeal as jest.Mock).mockResolvedValueOnce(undefined);

    await skipMeal('2026-05-25', 'dinner');

    expect(restoreBySkippedMeal).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'chicken', quantity: 200 })]),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ Status: { select: { name: 'skipped' } } }),
      }),
    );
  });

  it('does not call restoreBySkippedMeal when meal has no linked recipe', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult(makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 2, 'planned')),
    );
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 2, 'skipped'),
    );

    await skipMeal('2026-05-25', 'breakfast');

    expect(restoreBySkippedMeal).not.toHaveBeenCalled();
  });
});

describe('updateServings', () => {
  it('restores ingredient delta to pantry when servings decrease', async () => {
    const recipeIngredients = [{ name: 'chicken', quantity: 200, unit: 'g', notes: null }];
    const mealPage = makeMealPage(
      'entry-1',
      '2026-05-25',
      'dinner',
      'Chicken Tikka',
      4,
      'planned',
      'recipe-1',
    );
    const recipePage = {
      id: 'recipe-1',
      object: 'page',
      last_edited_time: '2026-05-22T10:00:00.000Z',
      properties: {
        Title: { title: [{ plain_text: 'Chicken Tikka' }] },
        Ingredients: { rich_text: [{ plain_text: JSON.stringify(recipeIngredients) }] },
        Servings: { number: 4 },
      },
    };
    mockRetrieve.mockResolvedValueOnce(mealPage).mockResolvedValueOnce(recipePage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 2, 'planned', 'recipe-1'),
    );
    (restoreBySkippedMeal as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await updateServings('entry-1', 2);

    expect(restoreBySkippedMeal).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'chicken', quantity: 100 })]),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'entry-1',
        properties: expect.objectContaining({ Servings: { number: 2 } }),
      }),
    );
    expect(result.servings).toBe(2);
  });

  it('deducts additional ingredients from pantry when servings increase', async () => {
    const recipeIngredients = [{ name: 'chicken', quantity: 200, unit: 'g', notes: null }];
    const mealPage = makeMealPage(
      'entry-1',
      '2026-05-25',
      'dinner',
      'Chicken Tikka',
      2,
      'planned',
      'recipe-1',
    );
    const recipePage = {
      id: 'recipe-1',
      object: 'page',
      last_edited_time: '2026-05-22T10:00:00.000Z',
      properties: {
        Title: { title: [{ plain_text: 'Chicken Tikka' }] },
        Ingredients: { rich_text: [{ plain_text: JSON.stringify(recipeIngredients) }] },
        Servings: { number: 4 },
      },
    };
    mockRetrieve.mockResolvedValueOnce(mealPage).mockResolvedValueOnce(recipePage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 4, 'planned', 'recipe-1'),
    );
    (deductByMeal as jest.Mock).mockResolvedValueOnce(undefined);

    const result = await updateServings('entry-1', 4);

    expect(deductByMeal).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'chicken', quantity: 100 })]),
    );
    expect(result.servings).toBe(4);
  });

  it('makes no pantry changes when servings are unchanged', async () => {
    const mealPage = makeMealPage(
      'entry-1',
      '2026-05-25',
      'dinner',
      'Chicken Tikka',
      4,
      'planned',
      'recipe-1',
    );
    mockRetrieve.mockResolvedValueOnce(mealPage);
    mockUpdate.mockResolvedValueOnce(mealPage);

    await updateServings('entry-1', 4);

    expect(restoreBySkippedMeal).not.toHaveBeenCalled();
    expect(deductByMeal).not.toHaveBeenCalled();
  });

  it('makes no pantry changes when meal has no linked recipe', async () => {
    const mealPage = makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 2, 'planned');
    mockRetrieve.mockResolvedValueOnce(mealPage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 4, 'planned'),
    );

    await updateServings('entry-1', 4);

    expect(restoreBySkippedMeal).not.toHaveBeenCalled();
    expect(deductByMeal).not.toHaveBeenCalled();
  });
});

describe('markConsumed', () => {
  it('calls onConsumed callback with recipe ingredients and updates status to consumed', async () => {
    const recipeIngredients = [{ name: 'chicken', quantity: 200, unit: 'g', notes: null }];
    const mealPage = makeMealPage(
      'entry-1',
      '2026-05-25',
      'dinner',
      'Chicken Tikka',
      4,
      'planned',
      'recipe-1',
    );
    const recipePage = {
      id: 'recipe-1',
      object: 'page',
      last_edited_time: '2026-05-22T10:00:00.000Z',
      properties: {
        Ingredients: { rich_text: [{ plain_text: JSON.stringify(recipeIngredients) }] },
      },
    };

    mockRetrieve.mockResolvedValueOnce(mealPage).mockResolvedValueOnce(recipePage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'dinner', 'Chicken Tikka', 4, 'consumed', 'recipe-1'),
    );

    const onConsumed = jest.fn().mockResolvedValueOnce(undefined);
    await markConsumed('entry-1', onConsumed);

    expect(onConsumed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'chicken' })]),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'entry-1',
        properties: expect.objectContaining({
          Status: { select: { name: 'consumed' } },
        }),
      }),
    );
  });

  it('throws when meal entry is already consumed', async () => {
    const mealPage = makeMealPage(
      'entry-1',
      '2026-05-25',
      'dinner',
      'Chicken Tikka',
      4,
      'consumed',
      'recipe-1',
    );
    mockRetrieve.mockResolvedValueOnce(mealPage);

    const onConsumed = jest.fn();
    await expect(markConsumed('entry-1', onConsumed)).rejects.toThrow(/already consumed/i);

    expect(onConsumed).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('calls onConsumed with empty array when meal has no linked recipe', async () => {
    const mealPage = makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 2, 'planned');
    mockRetrieve.mockResolvedValueOnce(mealPage);
    mockUpdate.mockResolvedValueOnce(
      makeMealPage('entry-1', '2026-05-25', 'breakfast', 'Toast', 2, 'consumed'),
    );

    const onConsumed = jest.fn().mockResolvedValueOnce(undefined);
    await markConsumed('entry-1', onConsumed);

    expect(onConsumed).toHaveBeenCalledWith([]);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          Status: { select: { name: 'consumed' } },
        }),
      }),
    );
  });
});

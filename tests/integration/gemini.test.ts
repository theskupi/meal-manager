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

const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import { extractRecipe, ExtractionError, NoRecipeFoundError } from '../../src/integrations/gemini';

const validRecipeJson = JSON.stringify({
  title: 'Test Pasta',
  servings: 4,
  prepTimeMinutes: 15,
  ingredients: [
    { name: 'pasta', quantity: 300, unit: 'g', notes: null },
    { name: 'tomatoes', quantity: 200, unit: 'g', notes: null },
    { name: 'garlic', quantity: 2, unit: 'piece', notes: null },
  ],
  steps: ['Boil pasta', 'Make sauce', 'Combine'],
  tags: ['italian'],
});

function mockResponse(text: string) {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => text },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractRecipe', () => {
  it('returns a valid Recipe when model returns correct JSON', async () => {
    mockResponse(validRecipeJson);

    const recipe = await extractRecipe('base64imagedata');

    expect(recipe.title).toBe('Test Pasta');
    expect(recipe.ingredients).toHaveLength(3);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('throws NoRecipeFoundError when model returns no_recipe_found', async () => {
    mockResponse(JSON.stringify({ error: 'no_recipe_found' }));

    await expect(extractRecipe('base64imagedata')).rejects.toBeInstanceOf(NoRecipeFoundError);
  });

  it('throws ExtractionError when flash returns fewer than 3 ingredients', async () => {
    const twoIngredientJson = JSON.stringify({
      title: 'Simple Dish',
      servings: 2,
      prepTimeMinutes: null,
      ingredients: [
        { name: 'flour', quantity: 100, unit: 'g', notes: null },
        { name: 'water', quantity: 200, unit: 'ml', notes: null },
      ],
      steps: ['Mix'],
      tags: [],
    });
    mockResponse(twoIngredientJson);

    await expect(extractRecipe('base64imagedata')).rejects.toBeInstanceOf(ExtractionError);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('throws ExtractionError when model returns unparseable response', async () => {
    mockResponse('this is not json at all !!!');

    await expect(extractRecipe('base64imagedata')).rejects.toBeInstanceOf(ExtractionError);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});

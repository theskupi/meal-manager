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

jest.mock('../../src/integrations/gemini', () => {
  const actual = jest.requireActual<typeof import('../../src/integrations/gemini')>(
    '../../src/integrations/gemini',
  );
  return { ...actual, extractRecipe: jest.fn() };
});

jest.mock('../../src/integrations/groq', () => ({
  repairJson: jest.fn(),
  parseIntent: jest.fn(),
}));

jest.mock('../../src/integrations/telegram', () => ({
  bot: {
    telegram: {
      getFile: jest.fn(),
    },
  },
}));

global.fetch = jest.fn();

import { extractRecipe } from '../../src/integrations/gemini';
import { repairJson } from '../../src/integrations/groq';
import { bot } from '../../src/integrations/telegram';
import { scanPhoto, ExtractionError, NoRecipeFoundError } from '../../src/services/recipe-scanner';

const mockExtractRecipe = extractRecipe as jest.MockedFunction<typeof extractRecipe>;
const mockRepairJson = repairJson as jest.MockedFunction<typeof repairJson>;
const mockGetFile = bot.telegram.getFile as jest.MockedFunction<typeof bot.telegram.getFile>;
const mockFetch = global.fetch as jest.MockedFunction<typeof global.fetch>;

const validRecipe = {
  title: 'Spaghetti Carbonara',
  servings: 4,
  prepTimeMinutes: 20,
  ingredients: [
    { name: 'spaghetti', quantity: 400, unit: 'g' as const, notes: null },
    { name: 'eggs', quantity: 4, unit: 'piece' as const, notes: null },
    { name: 'pancetta', quantity: 150, unit: 'g' as const, notes: 'diced' },
  ],
  steps: ['Cook pasta', 'Fry pancetta', 'Combine'],
  tags: ['italian', 'pasta'],
};

function makeFetchResponse(base64Data = 'dGVzdA=='): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: jest.fn().mockResolvedValue(Buffer.from(base64Data, 'base64')),
  } as unknown as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFile.mockResolvedValue({ file_path: 'photos/test.jpg' } as Awaited<
    ReturnType<typeof bot.telegram.getFile>
  >);
  mockFetch.mockImplementation(makeFetchResponse());
});

describe('scanPhoto', () => {
  it('returns a validated Recipe on successful Gemini extraction', async () => {
    mockExtractRecipe.mockResolvedValue(validRecipe);

    const result = await scanPhoto('file-id-123');

    expect(result.title).toBe('Spaghetti Carbonara');
    expect(result.ingredients).toHaveLength(3);
    expect(mockExtractRecipe).toHaveBeenCalledTimes(1);
    expect(mockRepairJson).not.toHaveBeenCalled();
  });

  it('throws NoRecipeFoundError when Gemini finds no recipe', async () => {
    mockExtractRecipe.mockRejectedValue(new NoRecipeFoundError());

    await expect(scanPhoto('file-id-123')).rejects.toBeInstanceOf(NoRecipeFoundError);
  });

  it('throws ExtractionError when extraction fails and repair also fails', async () => {
    mockExtractRecipe.mockRejectedValue(new ExtractionError('parse failed'));

    await expect(scanPhoto('file-id-123')).rejects.toBeInstanceOf(ExtractionError);
  });

  it('downloads the highest-res photo using the file_path from getFile', async () => {
    mockExtractRecipe.mockResolvedValue(validRecipe);

    await scanPhoto('file-id-456');

    expect(mockGetFile).toHaveBeenCalledWith('file-id-456');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('photos/test.jpg'));
  });
});

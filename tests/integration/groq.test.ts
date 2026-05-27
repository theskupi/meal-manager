jest.mock('../../src/config', () => ({
  config: {
    telegram: { botToken: 'test-token', allowedUserIds: [], webhookUrl: undefined },
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
      householdSize: 2,
      nodeEnv: 'test',
      isDevelopment: true,
      isProduction: false,
    },
  },
}));

const mockCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

import { parseIntent, repairJson } from '../../src/integrations/groq';

function mockGroqResponse(content: string | null) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content } }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parseIntent', () => {
  it('parses a known intent with params', async () => {
    mockGroqResponse('{"intent":"query_pantry","params":{"query_type":"list"}}');
    const result = await parseIntent('what is in my pantry?');
    expect(result.intent).toBe('query_pantry');
    expect(result.params).toEqual({ query_type: 'list' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns unknown intent when model returns invalid JSON', async () => {
    mockGroqResponse('this is not valid JSON at all');
    const result = await parseIntent('hello world');
    expect(result.intent).toBe('unknown');
    expect(result.params).toEqual({});
  });

  it('recognises generate_menu intent', async () => {
    mockGroqResponse('{"intent":"generate_menu","params":{}}');
    const result = await parseIntent('generate my lunch plan for the week');
    expect(result.intent).toBe('generate_menu');
    expect(result.params).toEqual({});
  });

  it('recognises skip_meal intent with date and meal_type params', async () => {
    mockGroqResponse('{"intent":"skip_meal","params":{"date":"2026-05-30","meal_type":"lunch"}}');
    const result = await parseIntent('skip lunch on Friday');
    expect(result.intent).toBe('skip_meal');
    expect(result.params['date']).toBe('2026-05-30');
    expect(result.params['meal_type']).toBe('lunch');
  });

  it('returns unknown when model returns null content', async () => {
    mockGroqResponse(null);
    const result = await parseIntent('some ambiguous message');
    expect(result.intent).toBe('unknown');
  });
});

describe('repairJson', () => {
  it('returns repaired JSON string from model response', async () => {
    const repairedJson = '{"foo":"bar","baz":42}';
    mockGroqResponse(repairedJson);
    const result = await repairJson('{foo: "bar", baz: 42}');
    expect(result).toBe(repairedJson);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns the original text when model responds with null content', async () => {
    mockGroqResponse(null);
    const broken = '{broken json here';
    const result = await repairJson(broken);
    expect(result).toBe(broken);
  });

  it('passes the broken JSON to the model in the user message', async () => {
    mockGroqResponse('{}');
    const broken = '{bad: json}';
    await repairJson(broken);
    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = callArgs.messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain(broken);
  });
});

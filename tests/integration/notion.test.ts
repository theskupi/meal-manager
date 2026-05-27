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

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({})),
}));

import { withRetry } from '../../src/integrations/notion';

describe('withRetry (Notion client)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the return value on first successful call', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a non-retryable 4xx error', async () => {
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    const fn = jest.fn().mockRejectedValue(error);
    const assertion = expect(withRetry(fn)).rejects.toEqual(error);
    await jest.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on a 429 rate-limit error and succeeds', async () => {
    const rateLimitError = Object.assign(new Error('Rate Limited'), { status: 429 });
    const fn = jest.fn().mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce('retried-ok');
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    expect(await promise).toBe('retried-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on a 500 server error and succeeds', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce('server-retry-ok');
    const promise = withRetry(fn);
    await jest.runAllTimersAsync();
    expect(await promise).toBe('server-retry-ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after MAX_RETRIES (3) are exhausted', async () => {
    const rateLimitError = Object.assign(new Error('Rate Limited'), { status: 429 });
    const fn = jest.fn().mockRejectedValue(rateLimitError);
    const assertion = expect(withRetry(fn)).rejects.toEqual(rateLimitError);
    await jest.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('simulates upsert pattern — query then create both succeed', async () => {
    const queryFn = jest.fn().mockResolvedValue({ results: [], next_cursor: null });
    const createFn = jest
      .fn()
      .mockResolvedValue({ id: 'new-page-id', url: 'https://notion.so/new-page-id' });

    const queryPromise = withRetry(queryFn);
    await jest.runAllTimersAsync();
    const queryResult = (await queryPromise) as { results: unknown[]; next_cursor: null };
    expect(queryResult.results).toHaveLength(0);

    const createPromise = withRetry(createFn);
    await jest.runAllTimersAsync();
    const createResult = (await createPromise) as { id: string; url: string };
    expect(createResult.id).toBe('new-page-id');

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it('throttle: two rapid sequential calls both succeed', async () => {
    const fn1 = jest.fn().mockResolvedValue('first');
    const fn2 = jest.fn().mockResolvedValue('second');

    const p1 = withRetry(fn1);
    await jest.runAllTimersAsync();
    expect(await p1).toBe('first');

    const p2 = withRetry(fn2);
    await jest.runAllTimersAsync();
    expect(await p2).toBe('second');
  });
});

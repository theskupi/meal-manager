import { Client } from '@notionhq/client';
import { config } from '../config';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const MIN_INTERVAL_MS = 400; // 2.5 req/s

let lastRequestTime = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await throttle();
      return await fn();
    } catch (err) {
      lastError = err;
      const status =
        err !== null &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 0;
      const isRetryable = status === 429 || status >= 500;
      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt);
        console.warn(`[notion] Retryable error (status ${status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoffMs);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export const notionClient = new Client({ auth: config.notion.token });

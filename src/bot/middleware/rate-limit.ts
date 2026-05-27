import { Context, MiddlewareFn } from 'telegraf';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

const requestCounts = new Map<number, { count: number; windowStart: number }>();

export const rateLimitMiddleware: MiddlewareFn<Context> = (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  const entry = requestCounts.get(userId);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    requestCounts.set(userId, { count: 1, windowStart: now });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS) {
    console.warn(`[rate-limit] User ${userId} exceeded ${MAX_REQUESTS} requests/min`);
    return ctx.reply('⏳ Too many requests. Please wait a moment before trying again.');
  }

  return next();
};

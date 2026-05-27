import { Context, MiddlewareFn } from 'telegraf';
import { config } from '../../config';

export const authMiddleware: MiddlewareFn<Context> = (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !config.telegram.allowedUserIds.includes(userId)) {
    console.debug(
      `[auth] Blocked message from ${userId !== undefined ? 'unauthorised user' : 'unknown sender'}`,
    );
    return Promise.resolve();
  }
  return next();
};

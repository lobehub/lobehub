import { APIError } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

/**
 * Prefer banReason in the session-create error so deactivated users see why
 * they cannot sign in. Runs before the stock admin plugin hook.
 */
export const aicoBanMessage = (): BetterAuthPlugin => ({
  id: 'aico-ban-message',
  init() {
    return {
      options: {
        databaseHooks: {
          session: {
            create: {
              async before(session, ctx) {
                if (!ctx) return;
                const user = await ctx.context.internalAdapter.findUserById(session.userId);
                if (!user?.banned) return;

                if (user.banExpires && new Date(user.banExpires).getTime() < Date.now()) {
                  await ctx.context.internalAdapter.updateUser(session.userId, {
                    banExpires: null,
                    banReason: null,
                    banned: false,
                  });
                  return;
                }

                const reason =
                  typeof user.banReason === 'string' && user.banReason.trim()
                    ? user.banReason.trim()
                    : null;

                throw APIError.from('FORBIDDEN', {
                  code: 'BANNED_USER',
                  message: reason
                    ? `Your account has been deactivated. Reason: ${reason}`
                    : 'Your account has been deactivated. Please contact support if you believe this is an error.',
                });
              },
            },
          },
        },
      },
    };
  },
});

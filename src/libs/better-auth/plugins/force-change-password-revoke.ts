import { createAuthMiddleware } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

/**
 * Force `revokeOtherSessions` on `/change-password` so custom clients cannot
 * leave sibling sessions alive after a password change (AUTH-005).
 */
export const forceChangePasswordRevoke = (): BetterAuthPlugin => ({
  id: 'aico-force-change-password-revoke',
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === '/change-password',
        handler: createAuthMiddleware(async (ctx) => {
          return {
            context: {
              body: {
                ...(ctx.body as Record<string, unknown>),
                revokeOtherSessions: true,
              },
            },
          };
        }),
      },
    ],
  },
});

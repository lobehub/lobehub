import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { CHANGE_EMAIL_IN_USE_CODE } from '../constants';

const CHANGE_EMAIL_PATH = '/change-email';

/**
 * Reject a change-email request whose new address already belongs to another account.
 *
 * Better Auth answers such a request with `{ status: true }` and sends no email, to avoid
 * revealing which addresses are registered. The settings page then reports a sent
 * verification email that never arrives. That concealment protects nothing here: sign-in
 * (`/api/auth/check-user`) and sign-up already tell visitors whether an email is registered,
 * while this endpoint requires a signed-in session.
 */
export const changeEmailUniqueness = (): BetterAuthPlugin => ({
  hooks: {
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          const newEmail = ctx.body?.newEmail;
          if (typeof newEmail !== 'string') return;

          /**
           * The endpoint's session middleware has not run yet. Resolve the session first so
           * anonymous requests reach its 401 without an email lookup, and do it on a detached
           * context: Better Auth memoizes the lookup on the supplied context and lets query
           * parameters override its options, and this check must not seed either.
           */
          const session = await getSessionFromCtx(
            {
              ...ctx,
              context: { ...ctx.context, session: null },
              query: { disableCookieCache: true, disableRefresh: true },
            },
            { disableCookieCache: true, disableRefresh: true },
          );
          if (!session) return;

          // Better Auth lowercases the address before its own lookup; match that.
          const existing = await ctx.context.internalAdapter.findUserByEmail(
            newEmail.toLowerCase(),
          );
          // The requester's own address is left to Better Auth's "Email is the same" error.
          if (!existing || existing.user.id === session.user.id) return;

          throw new APIError('BAD_REQUEST', {
            code: CHANGE_EMAIL_IN_USE_CODE,
            message: 'This email is already used by another account.',
          });
        }),
        matcher: (ctx) => ctx.path === CHANGE_EMAIL_PATH,
      },
    ],
  },
  id: 'change-email-uniqueness',
});

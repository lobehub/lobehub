import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { isLinkOnlyProvider } from '@/libs/better-auth/utils/common';

interface UnlinkBody {
  accountId?: string;
  providerId?: string;
}

/**
 * Enforces providers that are only meant to be linked to an existing account (e.g. X).
 *
 * - Sign-in: hiding the provider from the sign-in page is not enough, because `/sign-in/social`
 *   accepts every configured provider, so a direct request could still sign in with, or sign up
 *   through, a link-only provider. Linking uses `/link-social` and is not affected.
 * - Unlink: Better Auth only refuses to unlink the last account. A link-only account cannot sign
 *   in, so unlinking the last sign-in-capable account (e.g. Google, keeping only X) would lock the
 *   user out. Count only accounts that can still sign in after the unlink.
 */
export const linkOnlyProviders = (): BetterAuthPlugin => ({
  hooks: {
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          const provider = (ctx.body as { provider?: unknown } | undefined)?.provider;

          if (typeof provider === 'string' && isLinkOnlyProvider(provider)) {
            throw new APIError('FORBIDDEN', {
              code: 'PROVIDER_LINK_ONLY',
              message: `${provider} can only be linked to an existing account`,
            });
          }
        }),
        matcher: (ctx) => ctx.path === '/sign-in/social',
      },
      {
        handler: createAuthMiddleware(async (ctx) => {
          const { accountId, providerId } = (ctx.body ?? {}) as UnlinkBody;
          // Unlinking a link-only account never removes a way to sign in.
          if (!providerId || isLinkOnlyProvider(providerId)) return;

          // No session: let the endpoint reject the request with its own error.
          const session = await getSessionFromCtx(ctx);
          if (!session) return;

          const accounts = await ctx.context.internalAdapter.findAccounts(session.user.id);
          // Mirror Better Auth's own lookup of the account it is about to delete.
          const target = accounts.find((account) =>
            accountId
              ? account.accountId === accountId && account.providerId === providerId
              : account.providerId === providerId,
          );
          if (!target) return;

          const canStillSignIn = accounts.some(
            (account) => account.id !== target.id && !isLinkOnlyProvider(account.providerId),
          );

          if (!canStillSignIn) {
            throw new APIError('BAD_REQUEST', {
              code: 'FAILED_TO_UNLINK_LAST_SIGN_IN_ACCOUNT',
              message: 'Cannot unlink the last account that can be used to sign in',
            });
          }
        }),
        matcher: (ctx) => ctx.path === '/unlink-account',
      },
    ],
  },
  id: 'link-only-providers',
});

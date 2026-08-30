import { PASSKEY_ERROR_CODES } from '@better-auth/passkey';
import { serverDB } from '@lobechat/database';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { type BetterAuthPlugin } from 'better-auth/types';

import { PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR } from '@/libs/better-auth/constants';
import {
  deletePasskeyWithLockoutGuard,
  PasskeyDeletionResult,
} from '@/libs/better-auth/deletePasskeyWithLockoutGuard';

interface PasskeyDeleteGuardOptions {
  disableEmailPassword: boolean;
  enabledSSOProviders: readonly string[];
  enableMagicLink: boolean;
}

/**
 * Replace Better Auth's passkey deletion handler with an atomic, ownership-
 * scoped delete. The client-side disabled state remains useful feedback, but
 * only this server transaction can close the two-tab stale-snapshot race.
 */
export const passkeyDeleteGuard = (options: PasskeyDeleteGuardOptions): BetterAuthPlugin => ({
  hooks: {
    before: [
      {
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session?.user?.id) throw new APIError('UNAUTHORIZED');

          const passkeyId = ctx.body?.id;
          // Leave malformed input to the passkey endpoint's own Zod schema.
          if (typeof passkeyId !== 'string') return;

          const result = await deletePasskeyWithLockoutGuard(serverDB, {
            ...options,
            passkeyId,
            userId: session.user.id,
          });

          if (result === PasskeyDeletionResult.NotFound) {
            throw APIError.from('NOT_FOUND', PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND);
          }

          if (result === PasskeyDeletionResult.WouldLockOut) {
            throw APIError.from('BAD_REQUEST', {
              code: PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR,
              message: PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR,
            });
          }

          return ctx.json({ status: true });
        }),
        matcher: (ctx) => ctx.path === '/passkey/delete-passkey',
      },
    ],
  },
  id: 'passkey-delete-guard',
});

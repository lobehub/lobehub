import {
  oidcAccessTokens,
  oidcAuthorizationCodes,
  oidcDeviceCodes,
  oidcGrants,
  oidcRefreshTokens,
  oidcSessions,
} from '@lobechat/database/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertOIDCUserActive,
  OIDC_USER_INACTIVE_ERROR_MESSAGE,
  revokeOIDCArtifactsByUserId,
} from './access-control';

describe('OIDC access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revokeOIDCArtifactsByUserId', () => {
    it('deletes all token and session artifacts for a user', async () => {
      const where = vi.fn().mockResolvedValue({ rowCount: 1 });
      const delete_ = vi.fn(() => ({ where }));
      const tx = { delete: delete_ };
      const db = {
        transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<void>) => callback(tx)),
      };

      await revokeOIDCArtifactsByUserId(
        db as unknown as Parameters<typeof revokeOIDCArtifactsByUserId>[0],
        'user-1',
      );

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(delete_).toHaveBeenCalledTimes(6);
      expect(delete_).toHaveBeenCalledWith(oidcAccessTokens);
      expect(delete_).toHaveBeenCalledWith(oidcAuthorizationCodes);
      expect(delete_).toHaveBeenCalledWith(oidcRefreshTokens);
      expect(delete_).toHaveBeenCalledWith(oidcDeviceCodes);
      expect(delete_).toHaveBeenCalledWith(oidcGrants);
      expect(delete_).toHaveBeenCalledWith(oidcSessions);
      expect(where).toHaveBeenCalledTimes(6);
    });
  });

  describe('assertOIDCUserActive', () => {
    const createDb = (rows: Array<{ banned: boolean | null; id: string }>) => {
      const limit = vi.fn().mockResolvedValue(rows);
      const where = vi.fn(() => ({ limit }));
      const from = vi.fn(() => ({ where }));

      return {
        db: {
          select: vi.fn(() => ({ from })),
        },
        from,
        limit,
        where,
      };
    };

    it('passes for an existing active user', async () => {
      const { db } = createDb([{ banned: false, id: 'user-1' }]);

      await expect(
        assertOIDCUserActive(db as unknown as Parameters<typeof assertOIDCUserActive>[0], 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('rejects a banned user', async () => {
      const { db } = createDb([{ banned: true, id: 'user-1' }]);

      await expect(
        assertOIDCUserActive(db as unknown as Parameters<typeof assertOIDCUserActive>[0], 'user-1'),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: OIDC_USER_INACTIVE_ERROR_MESSAGE,
      });
    });

    it('rejects a missing user', async () => {
      const { db } = createDb([]);

      await expect(
        assertOIDCUserActive(
          db as unknown as Parameters<typeof assertOIDCUserActive>[0],
          'missing-user',
        ),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: OIDC_USER_INACTIVE_ERROR_MESSAGE,
      });
    });
  });
});

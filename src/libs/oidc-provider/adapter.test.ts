import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DrizzleAdapter } from './adapter';

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

const createSelectDb = (rows: any[]) => {
  const chain = {
    from: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    where: vi.fn(() => chain),
  };
  return { select: vi.fn(() => chain) };
};

const createUpsertDb = (options?: { updateRejects?: boolean }) => {
  const updateWhere = vi.fn(() =>
    options?.updateRejects
      ? Promise.reject(new Error('update failed'))
      : Promise.resolve(undefined),
  );
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: updateWhere,
  };

  const insertChain = {
    onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
    values: vi.fn(() => insertChain),
  };

  const update = vi.fn(() => updateChain);

  return {
    db: {
      insert: vi.fn(() => insertChain),
      update,
    },
    update,
    updateChain,
  };
};

describe('OIDCAdapter (DrizzleAdapter)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('find Client enforcement', () => {
    const clientRow = {
      applicationType: 'native',
      clientSecret: null,
      enabled: true,
      grants: ['urn:ietf:params:oauth:grant-type:device_code'],
      id: 'lca_client_1',
      isFirstParty: false,
      redirectUris: [],
      responseTypes: [],
      scopes: ['openid', 'profile'],
    };

    it('returns the mapped client when enabled', async () => {
      const db = createSelectDb([clientRow]);
      const adapter = new DrizzleAdapter('Client', db as any);

      const result = await adapter.find('lca_client_1');

      expect(result).toMatchObject({
        client_id: 'lca_client_1',
        scope: 'openid profile',
      });
    });

    it('returns undefined when the client is disabled', async () => {
      const db = createSelectDb([{ ...clientRow, enabled: false }]);
      const adapter = new DrizzleAdapter('Client', db as any);

      const result = await adapter.find('lca_client_1');

      expect(result).toBeUndefined();
    });

    it('omits null optional fields so oidc-provider client schema accepts the metadata', async () => {
      const db = createSelectDb([
        {
          ...clientRow,
          clientUri: null,
          logoUri: null,
          policyUri: null,
          tokenEndpointAuthMethod: 'none',
          tosUri: null,
        },
      ]);
      const adapter = new DrizzleAdapter('Client', db as any);

      const result = (await adapter.find('lca_client_1')) as Record<string, unknown>;

      for (const key of ['client_secret', 'client_uri', 'logo_uri', 'policy_uri', 'tos_uri']) {
        expect(result).not.toHaveProperty(key);
      }
      expect(result).toMatchObject({
        client_id: 'lca_client_1',
        token_endpoint_auth_method: 'none',
      });
    });
  });

  describe('lastUsedAt stamping', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('stamps last_used_at for a user-created (lca_) client on AccessToken upsert', async () => {
      const { db, update, updateChain } = createUpsertDb();
      const adapter = new DrizzleAdapter('AccessToken', db as any);

      await adapter.upsert('token-1', { accountId: 'user-1', clientId: 'lca_client_1' }, 3600);
      await flush();

      expect(update).toHaveBeenCalledTimes(1);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      );
    });

    it('stamps last_used_at on DeviceCode upsert', async () => {
      const { db, update } = createUpsertDb();
      const adapter = new DrizzleAdapter('DeviceCode', db as any);

      await adapter.upsert(
        'device-1',
        { accountId: 'user-1', clientId: 'lca_client_2', userCode: 'ABCD' },
        600,
      );
      await flush();

      expect(update).toHaveBeenCalledTimes(1);
    });

    it('does not stamp for static first-party clients', async () => {
      const { db, update } = createUpsertDb();
      const adapter = new DrizzleAdapter('AccessToken', db as any);

      await adapter.upsert('token-2', { accountId: 'user-1', clientId: 'lobehub-cli' }, 3600);
      await flush();

      expect(update).not.toHaveBeenCalled();
    });

    it('does not throw when the stamping update fails', async () => {
      const { db } = createUpsertDb({ updateRejects: true });
      const adapter = new DrizzleAdapter('AccessToken', db as any);

      await expect(
        adapter.upsert('token-3', { accountId: 'user-1', clientId: 'lca_client_3' }, 3600),
      ).resolves.toBeUndefined();
      await flush();
    });
  });
});

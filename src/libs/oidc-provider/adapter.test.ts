import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DrizzleAdapter } from './adapter';

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

const mockDecrypt = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: async () => ({ decrypt: mockDecrypt, encrypt: mockEncrypt }),
  },
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

    it('returns undefined for a web app whose secret has not been generated yet', async () => {
      const db = createSelectDb([
        {
          ...clientRow,
          applicationType: 'web',
          clientSecret: null,
          tokenEndpointAuthMethod: 'client_secret_post',
        },
      ]);
      const adapter = new DrizzleAdapter('Client', db as any);

      expect(await adapter.find('lca_client_1')).toBeUndefined();
    });

    it('hands oidc-provider the decrypted client secret', async () => {
      mockDecrypt.mockResolvedValue({ plaintext: 'lcs_plain', wasAuthentic: true });
      const db = createSelectDb([{ ...clientRow, clientSecret: 'iv:tag:cipher' }]);
      const adapter = new DrizzleAdapter('Client', db as any);

      const result = (await adapter.find('lca_client_1')) as Record<string, unknown>;

      expect(mockDecrypt).toHaveBeenCalledWith('iv:tag:cipher');
      expect(result.client_secret).toBe('lcs_plain');
    });

    it('drops a client secret that fails to decrypt instead of passing ciphertext through', async () => {
      mockDecrypt.mockResolvedValue({ plaintext: '', wasAuthentic: false });
      const db = createSelectDb([{ ...clientRow, clientSecret: 'iv:tag:cipher' }]);
      const adapter = new DrizzleAdapter('Client', db as any);

      const result = (await adapter.find('lca_client_1')) as Record<string, unknown>;

      expect(result).not.toHaveProperty('client_secret');
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

  describe('upsert Client', () => {
    const registration = {
      client_name: 'Partner App',
      client_secret: 'plain',
      grant_types: ['client_credentials'],
      lobehub_owner_user_id: 'user-1',
      lobehub_owner_workspace_id: 'ws-1',
      redirect_uris: ['https://partner.example.com/cb'],
      response_types: [],
      scope: 'agent:read chat:read',
      token_endpoint_auth_method: 'client_secret_basic',
    };

    it('encrypts the secret on the way in so find can read it back', async () => {
      mockEncrypt.mockResolvedValue('iv:tag:cipher');
      const { db } = createUpsertDb();
      const insertChain = (db.insert as any)();
      const adapter = new DrizzleAdapter('Client', db as any);

      await adapter.upsert('lcd_client_1', registration, 0);

      expect(mockEncrypt).toHaveBeenCalledWith('plain');
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ clientSecret: 'iv:tag:cipher' }),
      );
    });

    it('stores a registration with its snake_case metadata and its owner', async () => {
      mockEncrypt.mockResolvedValue('iv:tag:cipher');
      const { db } = createUpsertDb();
      const insertChain = (db.insert as any)();
      const adapter = new DrizzleAdapter('Client', db as any);

      await adapter.upsert('lcd_client_1', { ...registration, isFirstParty: true }, 0);

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          grants: ['client_credentials'],
          id: 'lcd_client_1',
          isFirstParty: false,
          name: 'Partner App',
          redirectUris: ['https://partner.example.com/cb'],
          scopes: ['agent:read', 'chat:read'],
          userId: 'user-1',
          workspaceId: 'ws-1',
        }),
      );
    });

    it('stores a registration pending approval as disabled', async () => {
      const { db } = createUpsertDb();
      const insertChain = (db.insert as any)();
      const adapter = new DrizzleAdapter('Client', db as any);

      await adapter.upsert('lcd_client_1', { ...registration, lobehub_pending_approval: true }, 0);

      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('refuses a registration without an owner', async () => {
      const { db } = createUpsertDb();
      const adapter = new DrizzleAdapter('Client', db as any);
      const { lobehub_owner_user_id: _owner, ...ownerless } = registration;

      await expect(adapter.upsert('lcd_client_1', ownerless, 0)).rejects.toThrow(/no owner/);
      expect(db.insert).not.toHaveBeenCalled();
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

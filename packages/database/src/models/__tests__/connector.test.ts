import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { ConnectorCredentials } from '../../schemas';
import { userConnectors, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorModel } from '../connector';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'connector-user';
const otherUserId = 'connector-other-user';
const workspaceId = 'connector-workspace';

// A gateKeeper that wraps/unwraps payloads with a recognizable prefix so we can
// assert encryption actually ran without depending on real crypto.
const gateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({
    plaintext: ciphertext.replace(/^enc:/, ''),
  })),
  encrypt: vi.fn(async (plaintext: string) => `enc:${plaintext}`),
};

const apikeyCredentials: ConnectorCredentials = { apiKey: 'secret-key', type: 'apikey' };

beforeEach(async () => {
  vi.clearAllMocks();
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'ws' });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ConnectorModel', () => {
  describe('create', () => {
    it('creates a connector without credentials', async () => {
      const model = new ConnectorModel(serverDB, userId);

      const result = await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      expect(result.id).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.workspaceId).toBeNull();
      expect(result.credentials).toBeNull();
      expect(gateKeeper.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts credentials with the constructor gateKeeper', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);

      const result = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'github',
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });

      expect(gateKeeper.encrypt).toHaveBeenCalledOnce();
      expect(result.credentials).toBe(`enc:${JSON.stringify(apikeyCredentials)}`);
    });

    it('stores plaintext credentials when no gateKeeper is provided', async () => {
      const model = new ConnectorModel(serverDB, userId);

      const result = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'custom',
        name: 'Custom',
        sourceType: 'custom',
        status: 'connected',
      });

      expect(result.credentials).toBe(JSON.stringify(apikeyCredentials));
    });

    it('persists workspaceId when the model is workspace-scoped', async () => {
      const model = new ConnectorModel(serverDB, userId, workspaceId);

      const result = await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      expect(result.workspaceId).toBe(workspaceId);
    });

    it('uses the gateKeeper passed to create over the constructor one', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const callGateKeeper = {
        decrypt: vi.fn(),
        encrypt: vi.fn(async (plaintext: string) => `call:${plaintext}`),
      };

      const result = await model.create(
        {
          credentials: JSON.stringify(apikeyCredentials),
          identifier: 'github',
          name: 'GitHub',
          sourceType: 'builtin',
          status: 'connected',
        },
        callGateKeeper,
      );

      expect(callGateKeeper.encrypt).toHaveBeenCalledOnce();
      expect(result.credentials).toBe(`call:${JSON.stringify(apikeyCredentials)}`);
    });
  });

  describe('query', () => {
    it('returns only the current user / workspace connectors with decrypted credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);

      await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'github',
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });
      // other user's connector must not leak
      const otherModel = new ConnectorModel(serverDB, otherUserId, undefined, gateKeeper);
      await otherModel.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      const rows = await model.query();

      expect(rows).toHaveLength(1);
      expect(rows[0].credentials).toEqual(apikeyCredentials);
      expect(gateKeeper.decrypt).toHaveBeenCalledOnce();
    });

    it('returns null credentials for rows without credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      const rows = await model.query();

      expect(rows[0].credentials).toBeNull();
      expect(gateKeeper.decrypt).not.toHaveBeenCalled();
    });

    it('falls back to null credentials when decryption / JSON parsing fails', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      // write a row whose decrypted payload is not valid JSON
      await serverDB.insert(userConnectors).values({
        credentials: 'enc:not-json',
        identifier: 'broken',
        name: 'Broken',
        sourceType: 'custom',
        status: 'error',
        userId,
      });

      const rows = await model.query();

      expect(rows[0].credentials).toBeNull();
    });

    it('returns raw plaintext credentials when no gateKeeper is set', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'custom',
        name: 'Custom',
        sourceType: 'custom',
        status: 'connected',
      });

      const rows = await model.query();

      expect(rows[0].credentials).toEqual(apikeyCredentials);
    });
  });

  describe('queryByIdentifiers', () => {
    it('returns an empty array for an empty identifier list', async () => {
      const model = new ConnectorModel(serverDB, userId);
      expect(await model.queryByIdentifiers([])).toEqual([]);
    });

    it('returns only connectors matching the given identifiers', async () => {
      const model = new ConnectorModel(serverDB, userId);
      await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });
      await model.create({
        identifier: 'github',
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });
      await model.create({
        identifier: 'slack',
        name: 'Slack',
        sourceType: 'builtin',
        status: 'connected',
      });

      const rows = await model.queryByIdentifiers(['linear', 'slack']);

      expect(rows.map((r) => r.identifier).sort()).toEqual(['linear', 'slack']);
    });
  });

  describe('findById', () => {
    it('returns the decrypted connector by id', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create({
        credentials: JSON.stringify(apikeyCredentials),
        identifier: 'github',
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });

      const found = await model.findById(created.id);

      expect(found?.id).toBe(created.id);
      expect(found?.credentials).toEqual(apikeyCredentials);
    });

    it('returns null when the id does not exist', async () => {
      const model = new ConnectorModel(serverDB, userId);
      expect(await model.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('returns null when the connector belongs to another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      const model = new ConnectorModel(serverDB, userId);
      expect(await model.findById(created.id)).toBeNull();
    });
  });

  describe('update', () => {
    it('updates non-credential fields without touching credentials', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      await model.update(created.id, { name: 'Linear Renamed' });

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, created.id));
      expect(row.name).toBe('Linear Renamed');
      expect(gateKeeper.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts credentials when provided in the patch', async () => {
      const model = new ConnectorModel(serverDB, userId, undefined, gateKeeper);
      const created = await model.create({
        identifier: 'github',
        name: 'GitHub',
        sourceType: 'builtin',
        status: 'connected',
      });

      const newCredentials = JSON.stringify({ token: 'bearer-token', type: 'bearer' });
      await model.update(created.id, { credentials: newCredentials });

      expect(gateKeeper.encrypt).toHaveBeenCalledWith(newCredentials);
      const found = await model.findById(created.id);
      expect(found?.credentials).toEqual({ token: 'bearer-token', type: 'bearer' });
    });

    it('does not update connectors owned by another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      const model = new ConnectorModel(serverDB, userId);
      await model.update(created.id, { name: 'Hacked' });

      const [row] = await serverDB
        .select()
        .from(userConnectors)
        .where(eq(userConnectors.id, created.id));
      expect(row.name).toBe('Linear');
    });
  });

  describe('updateStatus', () => {
    it('updates the connector status', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      await model.updateStatus(created.id, 'error');

      const found = await model.findById(created.id);
      expect(found?.status).toBe('error');
    });
  });

  describe('delete', () => {
    it('deletes a connector owned by the user', async () => {
      const model = new ConnectorModel(serverDB, userId);
      const created = await model.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      await model.delete(created.id);

      expect(await model.findById(created.id)).toBeNull();
    });

    it('does not delete connectors owned by another user', async () => {
      const otherModel = new ConnectorModel(serverDB, otherUserId);
      const created = await otherModel.create({
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'builtin',
        status: 'connected',
      });

      const model = new ConnectorModel(serverDB, userId);
      await model.delete(created.id);

      expect(await otherModel.findById(created.id)).not.toBeNull();
    });
  });
});

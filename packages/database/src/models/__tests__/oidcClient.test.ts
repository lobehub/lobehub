// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { oidcClients, oidcGrants, oidcRefreshTokens, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OidcClientModel } from '../oidcClient';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'oidc-client-model-test-user';
const otherUserId = 'oidc-client-model-other-user';

let oidcClientModel: OidcClientModel;

beforeEach(async () => {
  oidcClientModel = new OidcClientModel(serverDB, userId);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('OidcClientModel', () => {
  describe('create', () => {
    it('should create a client with lca_ prefixed id and fixed device-flow fields', async () => {
      const result = await oidcClientModel.create({ name: 'My App' });

      expect(result.id).toMatch(/^lca_[\dA-Za-z]{24}$/);
      expect(result.name).toBe('My App');
      expect(result.ownerId).toBe(userId);
      expect(result.enabled).toBe(true);
      expect(result.isFirstParty).toBe(false);
      expect(result.clientSecret).toBeNull();
      expect(result.tokenEndpointAuthMethod).toBe('none');
      expect(result.applicationType).toBe('native');
      expect(result.responseTypes).toEqual([]);
      expect(result.redirectUris).toEqual([]);
      expect(result.grants).toEqual([
        'urn:ietf:params:oauth:grant-type:device_code',
        'refresh_token',
      ]);
      expect(result.scopes).toEqual(['openid', 'profile', 'email', 'offline_access']);
    });

    it('should persist description and logoUri', async () => {
      const result = await oidcClientModel.create({
        description: 'a demo',
        logoUri: 'https://example.com/logo.png',
        name: 'My App',
      });

      expect(result.description).toBe('a demo');
      expect(result.logoUri).toBe('https://example.com/logo.png');
    });
  });

  describe('list', () => {
    it('should list own clients newest first', async () => {
      await serverDB.insert(oidcClients).values({
        applicationType: 'native',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        grants: [],
        id: 'lca_older',
        name: 'Older',
        ownerId: userId,
        redirectUris: [],
        responseTypes: [],
        scopes: [],
      });
      await serverDB.insert(oidcClients).values({
        applicationType: 'native',
        createdAt: new Date('2024-02-01T00:00:00Z'),
        grants: [],
        id: 'lca_newer',
        name: 'Newer',
        ownerId: userId,
        redirectUris: [],
        responseTypes: [],
        scopes: [],
      });

      const clients = await oidcClientModel.list();

      expect(clients).toHaveLength(2);
      expect(clients[0].id).toBe('lca_newer');
      expect(clients[1].id).toBe('lca_older');
    });

    it('should only list clients owned by the current user', async () => {
      await oidcClientModel.create({ name: 'Mine' });
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      await otherModel.create({ name: 'Theirs' });

      const clients = await oidcClientModel.list();

      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe('Mine');
    });
  });

  describe('findById', () => {
    it('should find an own client by id', async () => {
      const { id } = await oidcClientModel.create({ name: 'My App' });

      const found = await oidcClientModel.findById(id);

      expect(found?.id).toBe(id);
    });

    it('should not find a client owned by another user', async () => {
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ name: 'Theirs' });

      const found = await oidcClientModel.findById(id);

      expect(found).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update own client fields', async () => {
      const { id } = await oidcClientModel.create({ name: 'Old Name' });

      await oidcClientModel.update(id, { description: 'new desc', name: 'New Name' });

      const updated = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      expect(updated?.name).toBe('New Name');
      expect(updated?.description).toBe('new desc');
    });

    it('should not update a client owned by another user', async () => {
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ name: 'Theirs' });

      await oidcClientModel.update(id, { name: 'Hacked' });

      const unchanged = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      expect(unchanged?.name).toBe('Theirs');
    });
  });

  describe('setEnabled', () => {
    it('should toggle enabled on own client', async () => {
      const { id } = await oidcClientModel.create({ name: 'My App' });

      await oidcClientModel.setEnabled(id, false);

      const updated = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      expect(updated?.enabled).toBe(false);
    });

    it('should not toggle enabled on another user client', async () => {
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ name: 'Theirs' });

      await oidcClientModel.setEnabled(id, false);

      const unchanged = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      expect(unchanged?.enabled).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete own client and its dependent token rows', async () => {
      const { id } = await oidcClientModel.create({ name: 'My App' });

      await serverDB.insert(oidcGrants).values({
        clientId: id,
        data: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        id: 'grant-1',
        userId,
      });
      await serverDB.insert(oidcRefreshTokens).values({
        clientId: id,
        data: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        id: 'refresh-1',
        userId,
      });

      await oidcClientModel.delete(id);

      const client = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      const grant = await serverDB.query.oidcGrants.findFirst({
        where: eq(oidcGrants.id, 'grant-1'),
      });
      const refresh = await serverDB.query.oidcRefreshTokens.findFirst({
        where: eq(oidcRefreshTokens.id, 'refresh-1'),
      });

      expect(client).toBeUndefined();
      expect(grant).toBeUndefined();
      expect(refresh).toBeUndefined();
    });

    it('should not delete a client owned by another user', async () => {
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ name: 'Theirs' });

      await oidcClientModel.delete(id);

      const client = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, id),
      });
      expect(client).toBeDefined();
    });

    it('should not touch another user token rows when deleting fails ownership', async () => {
      const otherModel = new OidcClientModel(serverDB, otherUserId);
      const { id } = await otherModel.create({ name: 'Theirs' });

      await serverDB.insert(oidcGrants).values({
        clientId: id,
        data: {},
        expiresAt: new Date(Date.now() + 3_600_000),
        id: 'grant-other',
        userId: otherUserId,
      });

      await oidcClientModel.delete(id);

      const grant = await serverDB.query.oidcGrants.findFirst({
        where: eq(oidcGrants.id, 'grant-other'),
      });
      expect(grant).toBeDefined();
    });
  });
});

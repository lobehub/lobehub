import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleAdapter } from '@/libs/oidc-provider/adapter';

import { getTestDB } from '../../../core/getTestDB';
import { users } from '../../../schemas';
import {
  oidcAccessTokens,
  oidcClients,
  oidcDeviceCodes,
  oidcInteractions,
  oidcRefreshTokens,
  oidcSessions,
} from '../../../schemas/oidc';

const serverDB = await getTestDB();

// Test data
const testModelName = 'Session';
const testId = 'test-id';
const testUserId = 'test-user-id';
const testClientId = 'test-client-id';
const testGrantId = 'test-grant-id';
const testUserCode = 'test-user-code';
const testExpires = new Date(Date.now() + 3600 * 1000); // Expires in 1 hour

beforeEach(async () => {
  await serverDB.insert(users).values({ id: testUserId }).onConflictDoNothing();
});

// Clean up data after each test
afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(oidcClients);
  await serverDB.delete(oidcDeviceCodes);
  await serverDB.delete(oidcInteractions);
});

describe('DrizzleAdapter', () => {
  describe('constructor', () => {
    it('should create adapter instance correctly', () => {
      const adapter = new DrizzleAdapter(testModelName, serverDB);
      expect(adapter).toBeDefined();
    });
  });

  describe('upsert', () => {
    it('should create new record for Session model', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const payload = {
        accountId: testUserId,
        cookie: 'cookie-value',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await serverDB.query.oidcSessions.findFirst({
        where: eq(oidcSessions.id, testId),
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe(testId);
      expect(result?.userId).toBe(testUserId);
      expect(result?.data).toEqual(payload);
    });

    it('should create new record for Client model', async () => {
      const adapter = new DrizzleAdapter('Client', serverDB);
      const payload = {
        client_id: testClientId,
        client_uri: 'https://example.com',
        application_type: 'web',
        client_secret: 'secret',
        grant_types: ['authorization_code', 'refresh_token'],
        name: 'Test Client',
        redirectUris: ['https://example.com/callback'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
      };

      await adapter.upsert(testClientId, payload, 0);

      const result = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, testClientId),
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe(testClientId);
      expect(result?.name).toBe(payload.name);
      expect(result?.redirectUris).toEqual(payload.redirectUris);
      expect(result?.scopes).toEqual(['openid', 'profile', 'email']);
    });

    it('should create new record for AccessToken model', async () => {
      const adapter = new DrizzleAdapter('AccessToken', serverDB);
      const payload = {
        accountId: testUserId,
        clientId: testClientId,
        grantId: testGrantId,
        scope: 'openid profile',
        iat: Math.floor(Date.now() / 1000),
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await serverDB.query.oidcAccessTokens.findFirst({
        where: eq(oidcAccessTokens.id, testId),
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe(testId);
      expect(result?.userId).toBe(testUserId);
      expect(result?.clientId).toBe(testClientId);
      expect(result?.grantId).toBe(testGrantId);
      expect(result?.data).toEqual(payload);
    });

    it('should create new record for DeviceCode model with userCode', async () => {
      const adapter = new DrizzleAdapter('DeviceCode', serverDB);
      const payload = {
        clientId: testClientId,
        userCode: testUserCode,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await serverDB.query.oidcDeviceCodes.findFirst({
        where: eq(oidcDeviceCodes.id, testId),
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe(testId);
      expect(result?.clientId).toBe(testClientId);
      expect(result?.userCode).toBe(testUserCode);
      expect(result?.data).toEqual(payload);
    });

    it('should update existing Session record', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const initialPayload = { accountId: testUserId, cookie: 'initial-cookie' };
      const updatedPayload = { accountId: testUserId, cookie: 'updated-cookie' };

      // Initial insert
      await adapter.upsert(testId, initialPayload, 3600);
      let result = await serverDB.query.oidcSessions.findFirst({
        where: eq(oidcSessions.id, testId),
      });
      expect(result?.data).toEqual(initialPayload);

      // Update
      await adapter.upsert(testId, updatedPayload, 7200); // New expiration time
      result = await serverDB.query.oidcSessions.findFirst({ where: eq(oidcSessions.id, testId) });
      expect(result?.data).toEqual(updatedPayload);
      // Verify expiresAt is also updated (approximately 2 hours later)
      expect(result?.expiresAt).toBeInstanceOf(Date);
      const expectedExpires = Date.now() + 7200 * 1000;
      expect(result!.expiresAt!.getTime()).toBeGreaterThan(expectedExpires - 5000); // Allow 5 second tolerance
      expect(result!.expiresAt!.getTime()).toBeLessThan(expectedExpires + 5000);
    });

    it('should update existing Client record', async () => {
      const adapter = new DrizzleAdapter('Client', serverDB);
      const initialPayload = {
        client_id: testClientId,
        client_uri: 'https://initial.com',
        name: 'Initial Client',
        redirectUris: ['https://initial.com/callback'],
        scopes: ['openid'],
      };
      const updatedPayload = {
        ...initialPayload,
        client_uri: 'https://updated.com',
        name: 'Updated Client',
        scopes: ['openid', 'profile'],
        scope: 'openid profile',
        redirectUris: ['https://updated.com/callback'],
      };

      // Initial insert
      await adapter.upsert(testClientId, initialPayload, 0);
      let result = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, testClientId),
      });

      expect(result?.name).toBe('Initial Client');
      expect(result?.clientUri).toBe('https://initial.com');
      expect(result?.scopes).toEqual(['openid']);

      // Update
      await adapter.upsert(testClientId, updatedPayload, 0);
      result = await serverDB.query.oidcClients.findFirst({
        where: eq(oidcClients.id, testClientId),
      });
      expect(result?.name).toBe('Updated Client');
      expect(result?.clientUri).toBe('https://updated.com');
      expect(result?.scopes).toEqual(['openid', 'profile']);
      expect(result?.redirectUris).toEqual(['https://updated.com/callback']);
    });
  });

  describe('find', () => {
    it('should find existing record', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const payload = {
        accountId: testUserId,
        cookie: 'cookie-value',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await adapter.find(testId);

      expect(result).toBeDefined();
      expect(result).toEqual(payload);
    });

    it('should return correct format for Client model', async () => {
      const adapter = new DrizzleAdapter('Client', serverDB);
      const payload = {
        client_id: testClientId,
        client_uri: 'https://example.com',
        application_type: 'web',
        client_secret: 'secret',
        grant_types: ['authorization_code', 'refresh_token'],
        name: 'Test Client',
        redirectUris: ['https://example.com/callback'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
      };

      await adapter.upsert(testClientId, payload, 0);

      const result = await adapter.find(testClientId);

      expect(result).toBeDefined();
      expect(result.client_id).toBe(testClientId);
      expect(result.client_secret).toBe(payload.client_secret);
      expect(result.redirect_uris).toEqual(payload.redirectUris);
      expect(result.scope).toBe(payload.scope);
    });

    it('should return undefined if record does not exist', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const result = await adapter.find('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined if record is expired', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const payload = {
        accountId: testUserId,
        cookie: 'cookie-value',
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };

      // Negative expiration time means immediate expiration
      await adapter.upsert(testId, payload, -1);

      // Wait briefly to ensure expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await adapter.find(testId);

      expect(result).toBeUndefined();
    });

    it('should return undefined if record is consumed', async () => {
      const adapter = new DrizzleAdapter('AccessToken', serverDB);
      const payload = { accountId: testUserId, clientId: testClientId };
      await adapter.upsert(testId, payload, 3600);

      // Consume the record
      await adapter.consume(testId);

      // Find consumed record
      const result = await adapter.find(testId);
      expect(result).toBeUndefined();
    });

    it('should allow RefreshToken reuse within grace period', async () => {
      const adapter = new DrizzleAdapter('RefreshToken', serverDB);
      const payload = {
        accountId: testUserId,
        clientId: testClientId,
        grantId: testGrantId,
      };
      await adapter.upsert(testId, payload, 3600);

      // Consume the record
      await adapter.consume(testId);

      // Within grace period (180 seconds), should still find the record
      const result = await adapter.find(testId);
      expect(result).toBeDefined();
      expect(result).toEqual(payload);
    });

    it('should reject RefreshToken reuse after grace period expires', async () => {
      const adapter = new DrizzleAdapter('RefreshToken', serverDB);
      const payload = {
        accountId: testUserId,
        clientId: testClientId,
        grantId: testGrantId,
      };
      await adapter.upsert(testId, payload, 3600);

      // Directly update consumedAt to a past time (beyond grace period)
      // Grace period is 180 seconds, set to 200 seconds ago
      const pastConsumedAt = new Date(Date.now() - 200 * 1000);
      await serverDB
        .update(oidcRefreshTokens)
        .set({ consumedAt: pastConsumedAt })
        .where(eq(oidcRefreshTokens.id, testId));

      // Grace period expired, should return undefined
      const result = await adapter.find(testId);
      expect(result).toBeUndefined();
    });
  });

  describe('findByUserCode', () => {
    it('should find DeviceCode record by userCode', async () => {
      const adapter = new DrizzleAdapter('DeviceCode', serverDB);
      const payload = {
        clientId: testClientId,
        userCode: testUserCode,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await adapter.findByUserCode(testUserCode);

      expect(result).toBeDefined();
      expect(result).toEqual(payload);
    });

    it('should return undefined if DeviceCode record is expired', async () => {
      const adapter = new DrizzleAdapter('DeviceCode', serverDB);
      const payload = { clientId: testClientId, userCode: testUserCode };
      // Use negative expiresIn to make it expire immediately
      await adapter.upsert(testId, payload, -1);
      await new Promise((resolve) => setTimeout(resolve, 10)); // Brief wait to ensure expiration

      const result = await adapter.findByUserCode(testUserCode);
      expect(result).toBeUndefined();
    });

    it('should return undefined if DeviceCode record is consumed', async () => {
      const adapter = new DrizzleAdapter('DeviceCode', serverDB);
      const payload = { clientId: testClientId, userCode: testUserCode };
      await adapter.upsert(testId, payload, 3600);

      // Consume the record
      await adapter.consume(testId);

      // Find consumed record
      const result = await adapter.findByUserCode(testUserCode);
      expect(result).toBeUndefined();
    });

    it('should throw error on non-DeviceCode model', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      await expect(adapter.findByUserCode(testUserCode)).rejects.toThrow();
    });
  });

  describe('findSessionByUserId', () => {
    it('should find Session record by userId', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const payload = {
        accountId: testUserId,
        cookie: 'cookie-value',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      const result = await adapter.findSessionByUserId(testUserId);

      expect(result).toBeDefined();
      expect(result).toEqual(payload);
    });

    it('should return undefined on non-Session model', async () => {
      const adapter = new DrizzleAdapter('AccessToken', serverDB);
      const result = await adapter.findSessionByUserId(testUserId);
      expect(result).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should delete existing record', async () => {
      const adapter = new DrizzleAdapter('Session', serverDB);
      const payload = {
        accountId: testUserId,
        cookie: 'cookie-value',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      // Confirm record exists
      let result = await serverDB.query.oidcSessions.findFirst({
        where: eq(oidcSessions.id, testId),
      });
      expect(result).toBeDefined();

      // Delete record
      await adapter.destroy(testId);

      // Verify record is deleted
      result = await serverDB.query.oidcSessions.findFirst({
        where: eq(oidcSessions.id, testId),
      });
      expect(result).toBeUndefined();
    });
  });

  describe('consume', () => {
    it('should mark record as consumed', async () => {
      const adapter = new DrizzleAdapter('AccessToken', serverDB);
      const payload = {
        accountId: testUserId,
        clientId: testClientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await adapter.upsert(testId, payload, 3600);

      // Consume the record
      await adapter.consume(testId);

      // Verify record is marked as consumed
      const result = await serverDB.query.oidcAccessTokens.findFirst({
        where: eq(oidcAccessTokens.id, testId),
      });

      expect(result).toBeDefined();
      expect(result?.consumedAt).not.toBeNull();
    });
  });

  describe('revokeByGrantId', () => {
    it('should revoke all records associated with specified grantId', async () => {
      // Create AccessToken record
      const accessTokenAdapter = new DrizzleAdapter('AccessToken', serverDB);
      const accessTokenPayload = {
        accountId: testUserId,
        clientId: testClientId,
        grantId: testGrantId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      await accessTokenAdapter.upsert(testId, accessTokenPayload, 3600);

      // Create RefreshToken record
      const refreshTokenAdapter = new DrizzleAdapter('RefreshToken', serverDB);
      const refreshTokenPayload = {
        accountId: testUserId,
        clientId: testClientId,
        grantId: testGrantId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      await refreshTokenAdapter.upsert('refresh-' + testId, refreshTokenPayload, 3600);

      // Revoke all records associated with testGrantId
      await accessTokenAdapter.revokeByGrantId(testGrantId);

      // Verify records are deleted
      const accessTokenResult = await serverDB.query.oidcAccessTokens.findFirst({
        where: eq(oidcAccessTokens.id, testId),
      });

      expect(accessTokenResult).toBeUndefined();

      const refreshTokenResult = await serverDB.query.oidcRefreshTokens.findFirst({
        where: eq(oidcRefreshTokens.id, `refresh-${testId}`),
      });
      console.log('refreshTokenResult:', refreshTokenResult);
      expect(refreshTokenResult).toBeUndefined();
    });

    it('should return directly on Grant model', async () => {
      // Grant model does not need to be revoked by grantId
      const adapter = new DrizzleAdapter('Grant', serverDB);
      await adapter.revokeByGrantId(testGrantId);
      // Test passes if no error is thrown
    });
  });

  describe('createAdapterFactory', () => {
    it('should create an adapter factory function', () => {
      const factory = DrizzleAdapter.createAdapterFactory(serverDB as any);
      expect(factory).toBeDefined();
      expect(typeof factory).toBe('function');

      const adapter = factory('Session');
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(DrizzleAdapter);
    });
  });

  describe('getTable (indirectly via public methods)', () => {
    it('should throw error when using unsupported model name', async () => {
      const invalidAdapter = new DrizzleAdapter('InvalidModelName', serverDB);
      // Call a method that triggers getTable
      await expect(invalidAdapter.find('any-id')).rejects.toThrow('不支持的模型: InvalidModelName');
      await expect(invalidAdapter.upsert('any-id', {}, 3600)).rejects.toThrow(
        '不支持的模型: InvalidModelName',
      );
      await expect(invalidAdapter.destroy('any-id')).rejects.toThrow(
        '不支持的模型: InvalidModelName',
      );
      await expect(invalidAdapter.consume('any-id')).rejects.toThrow(
        '不支持的模型: InvalidModelName',
      );
      await expect(invalidAdapter.revokeByGrantId('any-grant-id')).rejects.toThrow(
        '不支持的模型: InvalidModelName',
      );
    });
  });
});

// @vitest-environment node
import { API_KEY_PREFIX } from '@lobechat/utils/apiKey';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLambdaContext } from '@/libs/trpc/lambda/context';

import { lambdaRouter } from '../index';

const { mockFindByKey, mockGetSession, workspaceMembers } = vi.hoisted(() => ({
  mockFindByKey: vi.fn(),
  mockGetSession: vi.fn(),
  // `${workspaceId}:${userId}` pairs the membership check accepts
  workspaceMembers: new Set<string>(),
}));

vi.mock('@/auth', () => ({ auth: { api: { getSession: mockGetSession } } }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));

vi.mock('@/database/models/apiKey', () => ({
  ApiKeyModel: Object.assign(
    vi.fn(function () {
      return { updateLastUsed: vi.fn().mockResolvedValue(undefined) };
    }),
    { findByKey: mockFindByKey },
  ),
}));

vi.mock('@/database/models/workspace', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasActiveWorkspaceMembership: vi.fn(async () => true),
}));

vi.mock('@/business/server/workspaceApiKey', () => ({
  canUseWorkspaceApiKeys: vi.fn(async () => true),
}));

vi.mock('@/envs/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authEnv: { ENABLE_OIDC: false },
}));

// The OSS stub leaves `ctx.workspaceId` untouched; the cloud override demotes a
// header naming a workspace the caller is not a member of to personal mode.
// Mirror that demotion so the procedure is exercised against the scope the
// middleware leaves, not the raw header.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  const { trpc } = await import('@/libs/trpc/lambda/init');

  const cloudWorkspaceAuth = trpc.middleware(async ({ ctx, next }) => {
    const isMember = !!ctx.workspaceId && workspaceMembers.has(`${ctx.workspaceId}:${ctx.userId}`);

    return next({ ctx: { workspaceId: isMember ? ctx.workspaceId : undefined } });
  });

  return {
    ...(await importOriginal<Record<string, unknown>>()),
    cloudWorkspaceAuth,
    wsCompatProcedure: authedProcedure.use(cloudWorkspaceAuth),
  };
});

const API_KEY = `${API_KEY_PREFIX}aaaaaaaaaaaaaaaa`;

const apiKeyRecord = (workspaceId: string | null, scopes: string[] | null = null) => ({
  accessedAt: new Date(),
  createdAt: new Date(),
  enabled: true,
  expiresAt: null,
  id: 'key-1',
  key: 'encrypted-key',
  keyHash: 'hashed-key',
  lastUsedAt: null,
  name: 'Test API Key',
  scopes,
  updatedAt: new Date(),
  userId: 'key-user',
  workspaceId,
});

const getScope = async (headers: Record<string, string>) => {
  const request = new NextRequest('https://example.com/trpc/lambda/auth.getScope', { headers });
  const caller = lambdaRouter.createCaller(await createLambdaContext(request));

  return caller.auth.getScope();
};

beforeEach(() => {
  vi.clearAllMocks();
  workspaceMembers.clear();
  // the key issuer is an active member of the key's workspace
  workspaceMembers.add('ws-key:key-user');
  mockGetSession.mockResolvedValue(null);
});

describe('auth.getScope', () => {
  describe('workspace API key', () => {
    beforeEach(() => {
      mockFindByKey.mockResolvedValue(apiKeyRecord('ws-key'));
    });

    it('reports the key workspace when no header is sent', async () => {
      await expect(getScope({ 'X-API-Key': API_KEY })).resolves.toEqual({
        scope: 'workspace',
        source: 'apiKey',
        workspaceId: 'ws-key',
      });
    });

    it('reports the key workspace when the header names the same workspace', async () => {
      await expect(getScope({ 'X-API-Key': API_KEY, 'X-Workspace-Id': 'ws-key' })).resolves.toEqual(
        { scope: 'workspace', source: 'apiKey', workspaceId: 'ws-key' },
      );
    });

    it('rejects a header naming another workspace instead of reporting either scope', async () => {
      await expect(
        getScope({ 'X-API-Key': API_KEY, 'X-Workspace-Id': 'ws-other' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('stays reachable for a restricted key', async () => {
      mockFindByKey.mockResolvedValue(apiKeyRecord('ws-key', ['file:read']));

      await expect(getScope({ 'X-API-Key': API_KEY })).resolves.toEqual({
        scope: 'workspace',
        source: 'apiKey',
        workspaceId: 'ws-key',
      });
    });
  });

  describe('personal API key', () => {
    beforeEach(() => {
      mockFindByKey.mockResolvedValue(apiKeyRecord(null));
    });

    it('reports personal scope without a header', async () => {
      await expect(getScope({ 'X-API-Key': API_KEY })).resolves.toEqual({
        scope: 'personal',
        source: 'personal',
        workspaceId: null,
      });
    });

    it('rejects a workspace header instead of reporting either scope', async () => {
      await expect(
        getScope({ 'X-API-Key': API_KEY, 'X-Workspace-Id': 'ws-key' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('session', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({ user: { id: 'session-user' } });
    });

    it('reports the header workspace for a member', async () => {
      workspaceMembers.add('ws-team:session-user');

      await expect(getScope({ 'X-Workspace-Id': 'ws-team' })).resolves.toEqual({
        scope: 'workspace',
        source: 'header',
        workspaceId: 'ws-team',
      });
    });

    it('reports personal scope when the header names a workspace the user is not in', async () => {
      await expect(getScope({ 'X-Workspace-Id': 'ws-team' })).resolves.toEqual({
        scope: 'personal',
        source: 'personal',
        workspaceId: null,
      });
    });

    it('reports personal scope without a header', async () => {
      await expect(getScope({})).resolves.toEqual({
        scope: 'personal',
        source: 'personal',
        workspaceId: null,
      });
    });
  });

  it('rejects an unauthenticated request', async () => {
    await expect(getScope({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

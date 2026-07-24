import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENAPI_WORKSPACE_HEADER, workspaceAuthMiddleware } from './workspace';

interface TestHonoEnv {
  Variables: {
    apiKeyWorkspaceId: string | null | undefined;
    authType: string | null;
    userId: string | null;
    workspaceId: string | undefined;
    workspaceRole: string | undefined;
  };
}

const {
  mockCanUseWorkspaceApiKeys,
  mockGetServerDB,
  mockGetUserRoles,
  mockWorkspaceMembersFindFirst,
  mockWorkspacesFindFirst,
} = vi.hoisted(() => ({
  mockCanUseWorkspaceApiKeys: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockGetUserRoles: vi.fn(),
  mockWorkspaceMembersFindFirst: vi.fn(),
  mockWorkspacesFindFirst: vi.fn(),
}));

vi.mock('@/business/server/workspaceApiKey', () => ({
  canUseWorkspaceApiKeys: mockCanUseWorkspaceApiKeys,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    getUserRoles = mockGetUserRoles;
  },
}));

vi.mock('@/database/schemas', () => ({
  workspaceMembers: {
    deletedAt: 'workspaceMembers.deletedAt',
    userId: 'workspaceMembers.userId',
    workspaceId: 'workspaceMembers.workspaceId',
  },
  workspaces: {
    id: 'workspaces.id',
  },
}));

interface TestAuthContext {
  apiKeyWorkspaceId?: string | null;
  authType?: string | null;
  userId?: string | null;
}

const createApp = ({
  apiKeyWorkspaceId,
  authType = 'oidc',
  userId = 'user-1',
}: TestAuthContext = {}) => {
  const app = new Hono<TestHonoEnv>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();

    return c.text(error.message, 500);
  });

  app.use('*', async (c, next) => {
    c.set('apiKeyWorkspaceId', apiKeyWorkspaceId);
    c.set('authType', authType);
    c.set('userId', userId);
    await next();
  });
  app.use('*', workspaceAuthMiddleware);
  app.get('/workspace', (c) =>
    c.json({
      workspaceId: c.get('workspaceId') ?? null,
      workspaceRole: c.get('workspaceRole') ?? null,
    }),
  );

  return app;
};

describe('OpenAPI workspace middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanUseWorkspaceApiKeys.mockResolvedValue(true);
    mockGetUserRoles.mockResolvedValue([{ name: 'workspace_owner', workspaceId: 'workspace-1' }]);

    mockGetServerDB.mockResolvedValue({
      query: {
        workspaceMembers: {
          findFirst: mockWorkspaceMembersFindFirst,
        },
        workspaces: {
          findFirst: mockWorkspacesFindFirst,
        },
      },
    });
    mockWorkspacesFindFirst.mockResolvedValue({ id: 'workspace-1' });
    mockWorkspaceMembersFindFirst.mockResolvedValue({ role: 'admin' });
  });

  it('continues in personal context when the workspace header is absent', async () => {
    const app = createApp();

    const response = await app.request('/workspace');

    await expect(response.json()).resolves.toEqual({
      workspaceId: null,
      workspaceRole: null,
    });
    expect(response.status).toBe(200);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('rejects workspace access when the request is unauthenticated', async () => {
    const app = createApp({ userId: null });

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-1' },
    });

    expect(response.status).toBe(401);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('rejects an unknown workspace', async () => {
    const app = createApp();
    mockWorkspacesFindFirst.mockResolvedValueOnce(undefined);

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-missing' },
    });

    expect(response.status).toBe(404);
    expect(mockWorkspaceMembersFindFirst).not.toHaveBeenCalled();
  });

  it('rejects workspace access when the user is not a member', async () => {
    const app = createApp();
    mockWorkspaceMembersFindFirst.mockResolvedValueOnce(undefined);

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-1' },
    });

    expect(response.status).toBe(403);
  });

  it('sets workspace context when the user is a workspace member', async () => {
    const app = createApp();

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: ' workspace-1 ' },
    });

    await expect(response.json()).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceRole: 'admin',
    });
    expect(response.status).toBe(200);
    expect(mockWorkspacesFindFirst).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceMembersFindFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps a personal API Key in personal context when the workspace header is absent', async () => {
    const app = createApp({ apiKeyWorkspaceId: null, authType: 'apikey' });

    const response = await app.request('/workspace');

    await expect(response.json()).resolves.toEqual({
      workspaceId: null,
      workspaceRole: null,
    });
    expect(response.status).toBe(200);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('rejects workspace access through a personal API Key', async () => {
    const app = createApp({ apiKeyWorkspaceId: null, authType: 'apikey' });

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-1' },
    });

    expect(response.status).toBe(403);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('automatically enters the workspace bound to a workspace API Key', async () => {
    const app = createApp({ apiKeyWorkspaceId: 'workspace-1', authType: 'apikey' });

    const response = await app.request('/workspace');

    await expect(response.json()).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceRole: 'admin',
    });
    expect(response.status).toBe(200);
    expect(mockWorkspacesFindFirst).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceMembersFindFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts a matching workspace header for a workspace API Key', async () => {
    const app = createApp({ apiKeyWorkspaceId: 'workspace-1', authType: 'apikey' });

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-1' },
    });

    await expect(response.json()).resolves.toEqual({
      workspaceId: 'workspace-1',
      workspaceRole: 'admin',
    });
    expect(response.status).toBe(200);
  });

  it('rejects a different workspace header for a workspace API Key', async () => {
    const app = createApp({ apiKeyWorkspaceId: 'workspace-1', authType: 'apikey' });

    const response = await app.request('/workspace', {
      headers: { [OPENAPI_WORKSPACE_HEADER]: 'workspace-2' },
    });

    expect(response.status).toBe(403);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('rejects a workspace API Key when workspace access is unavailable', async () => {
    mockCanUseWorkspaceApiKeys.mockResolvedValueOnce(false);
    const app = createApp({ apiKeyWorkspaceId: 'workspace-1', authType: 'apikey' });

    const response = await app.request('/workspace');

    expect(response.status).toBe(403);
    expect(mockCanUseWorkspaceApiKeys).toHaveBeenCalledWith('workspace-1');
  });

  it('rejects a workspace API Key when its issuer is no longer an owner', async () => {
    mockGetUserRoles.mockResolvedValueOnce([
      { name: 'workspace_member', workspaceId: 'workspace-1' },
    ]);
    const app = createApp({ apiKeyWorkspaceId: 'workspace-1', authType: 'apikey' });

    const response = await app.request('/workspace');

    expect(response.status).toBe(403);
    expect(mockCanUseWorkspaceApiKeys).not.toHaveBeenCalled();
  });
});

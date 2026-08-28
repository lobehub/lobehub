// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiKeyRouter } from '../apiKey';

const {
  mockApiKeyModel,
  mockApiKeyModelConstructor,
  mockAuditCreate,
  mockCanUseWorkspaceApiKeys,
  mockGetApiKeyMemberCreation,
} = vi.hoisted(() => {
  const apiKeyModel = {
    create: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    findById: vi.fn(),
    findByKey: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    validateKey: vi.fn(),
  };

  return {
    mockApiKeyModel: apiKeyModel,
    mockApiKeyModelConstructor: vi.fn(() => apiKeyModel),
    mockAuditCreate: vi.fn(),
    mockCanUseWorkspaceApiKeys: vi.fn(),
    mockGetApiKeyMemberCreation: vi.fn(),
  };
});

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(() => (opts: any) => opts.next({ ctx: opts.ctx })),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

vi.mock('@/business/server/workspaceApiKey', () => ({
  canUseWorkspaceApiKeys: mockCanUseWorkspaceApiKeys,
}));

vi.mock('@/database/models/apiKey', () => ({
  ApiKeyModel: mockApiKeyModelConstructor,
}));

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(() => ({ getApiKeyMemberCreation: mockGetApiKeyMemberCreation })),
}));

vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: vi.fn(() => ({ create: mockAuditCreate })),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const createCaller = (workspaceRole: 'admin' | 'member' | 'owner' = 'member') =>
  apiKeyRouter.createCaller({
    clientIp: '127.0.0.1',
    serverDB: {},
    userId: `${workspaceRole}-user`,
    workspaceId: 'workspace-1',
    workspaceRole,
  } as any);

describe('apiKeyRouter workspace member access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanUseWorkspaceApiKeys.mockResolvedValue(true);
    mockGetApiKeyMemberCreation.mockResolvedValue('all_members');
    mockAuditCreate.mockResolvedValue(undefined);
    mockApiKeyModel.create.mockResolvedValue({
      enabled: true,
      expiresAt: null,
      id: 'key-1',
      name: 'Member integration',
      scopes: ['*'],
      userId: 'member-user',
    });
    mockApiKeyModel.delete.mockResolvedValue(undefined);
    mockApiKeyModel.deleteAll.mockResolvedValue([]);
    mockApiKeyModel.query.mockResolvedValue([]);
    mockApiKeyModel.update.mockResolvedValue(undefined);
  });

  it('constructs an owner-scoped model for members and a workspace-wide model for admins', async () => {
    await createCaller('member').getApiKeys();
    expect(mockApiKeyModelConstructor).toHaveBeenLastCalledWith(
      expect.anything(),
      'member-user',
      'workspace-1',
      { canManageAll: false },
    );

    await createCaller('admin').getApiKeys();
    expect(mockApiKeyModelConstructor).toHaveBeenLastCalledWith(
      expect.anything(),
      'admin-user',
      'workspace-1',
      { canManageAll: true },
    );
  });

  it('allows members to create full-access keys when the workspace policy allows members', async () => {
    await createCaller('member').createApiKey({
      expiresAt: null,
      name: 'Member integration',
      scopes: ['*'],
    });

    expect(mockApiKeyModel.create).toHaveBeenCalledWith({
      expiresAt: null,
      name: 'Member integration',
      scopes: ['*'],
    });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.created',
        resourceId: 'key-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('rejects member creation when the workspace policy is admins only', async () => {
    mockGetApiKeyMemberCreation.mockResolvedValueOnce('admins_only');

    await expect(
      createCaller('member').createApiKey({ name: 'Blocked', scopes: ['agent:read'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockApiKeyModel.create).not.toHaveBeenCalled();
  });

  it('lets the creator edit scopes in place and records before/after grants', async () => {
    mockApiKeyModel.findById.mockResolvedValueOnce({
      enabled: true,
      expiresAt: null,
      id: 'key-1',
      name: 'Member integration',
      scopes: ['agent:read'],
      userId: 'member-user',
    });

    await createCaller('member').updateApiKey({
      id: 'key-1',
      value: { scopes: ['chat:read', 'chat:write'] },
    });

    expect(mockApiKeyModel.update).toHaveBeenCalledWith('key-1', {
      scopes: ['chat:read', 'chat:write'],
    });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.updated',
        metadata: expect.objectContaining({
          after: expect.objectContaining({ scopes: ['chat:read', 'chat:write'] }),
          before: expect.objectContaining({ scopes: ['agent:read'] }),
        }),
      }),
    );
  });

  it('prevents admins from editing another member key but still allows revocation', async () => {
    mockApiKeyModel.findById.mockResolvedValue({
      enabled: true,
      expiresAt: null,
      id: 'member-key',
      name: 'Member key',
      scopes: ['agent:read'],
      userId: 'member-user',
    });

    await expect(
      createCaller('admin').updateApiKey({
        id: 'member-key',
        value: { scopes: ['*'] },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await createCaller('admin').deleteApiKey({ id: 'member-key' });
    expect(mockApiKeyModel.delete).toHaveBeenCalledWith('member-key');
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api_key.revoked', resourceId: 'member-key' }),
    );
  });
});

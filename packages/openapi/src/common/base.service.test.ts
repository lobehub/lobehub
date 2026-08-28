// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from './base.service';

const {
  mockAiModels,
  mockAiProviders,
  mockBuildWorkspacePayload,
  mockBuildWorkspaceWhere,
  mockGetScopePermissions,
  mockHasAnyPermission,
} = vi.hoisted(() => ({
  mockAiModels: {
    id: 'aiModels.id',
    userId: 'aiModels.userId',
    workspaceId: 'aiModels.workspaceId',
  },
  mockAiProviders: {
    id: 'aiProviders.id',
    userId: 'aiProviders.userId',
    workspaceId: 'aiProviders.workspaceId',
  },
  mockBuildWorkspacePayload: vi.fn(),
  mockBuildWorkspaceWhere: vi.fn(),
  mockGetScopePermissions: vi.fn(),
  mockHasAnyPermission: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: mockBuildWorkspacePayload,
  buildWorkspaceWhere: mockBuildWorkspaceWhere,
}));

vi.mock('@/const/rbac', () => ({
  ALL_SCOPE: 'all',
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = mockHasAnyPermission;
  },
}));

vi.mock('@/database/schemas', () => ({
  agents: {},
  aiModels: mockAiModels,
  aiProviders: mockAiProviders,
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));

vi.mock('@/utils/rbac', () => ({
  getScopePermissions: mockGetScopePermissions,
}));

class TestService extends BaseService {
  workspaceWhere(cols: Parameters<BaseService['buildWorkspaceWhere']>[0]) {
    return this.buildWorkspaceWhere(cols);
  }

  workspacePayload<T extends object>(base: T) {
    return this.buildWorkspacePayload(base);
  }

  permissionWhere(
    cols: Parameters<BaseService['buildPermissionWhere']>[0],
    condition?: Parameters<BaseService['buildPermissionWhere']>[1],
  ) {
    return this.buildPermissionWhere(cols, condition);
  }

  globalPermission(permissionKey: Parameters<BaseService['hasGlobalPermission']>[0]) {
    return this.hasGlobalPermission(permissionKey);
  }

  ownerPermission(permissionKey: Parameters<BaseService['hasOwnerPermission']>[0]) {
    return this.hasOwnerPermission(permissionKey);
  }

  operationPermission(
    permissionKey: Parameters<BaseService['resolveOperationPermission']>[0],
    resourceInfo?: Parameters<BaseService['resolveOperationPermission']>[1],
  ) {
    return this.resolveOperationPermission(permissionKey, resourceInfo);
  }
}

const cols = {
  userId: 'table.userId',
  workspaceId: 'table.workspaceId',
} as any;

describe('BaseService workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildWorkspaceWhere.mockReturnValue('workspace-where');
    mockBuildWorkspacePayload.mockImplementation((context, base) => ({
      ...base,
      userId: context.userId,
      workspaceId: context.workspaceId ?? null,
    }));
    mockGetScopePermissions.mockReturnValue(['resolved-permission']);
    mockHasAnyPermission.mockResolvedValue(true);
  });

  it('builds workspace where conditions from the current service context', () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1', 'workspace-1');

    expect(service.workspaceWhere(cols)).toBe('workspace-where');
    expect(mockBuildWorkspaceWhere).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      cols,
    );
  });

  it('builds insert payloads with workspace ownership fields', () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1', 'workspace-1');

    expect(service.workspacePayload({ name: 'Provider' })).toEqual({
      name: 'Provider',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mockBuildWorkspacePayload).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { name: 'Provider' },
    );
  });

  it('keeps permission checks scoped to the active workspace owner context', () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1', 'workspace-1');

    expect(service.permissionWhere(cols, { userId: 'other-user' })).toBe('workspace-where');
    expect(mockBuildWorkspaceWhere).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      cols,
    );
  });

  it('uses the requested owner condition in personal context', () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1');

    expect(service.permissionWhere(cols, { userId: 'other-user' })).toBe('workspace-where');
    expect(mockBuildWorkspaceWhere).toHaveBeenCalledWith({ userId: 'other-user' }, cols);
  });

  it('does not add a permission where clause in personal context without an owner condition', () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1');

    expect(service.permissionWhere(cols)).toBeUndefined();
    expect(mockBuildWorkspaceWhere).not.toHaveBeenCalled();
  });

  it('passes workspace context into global and owner RBAC permission checks', async () => {
    const service = new TestService({} as LobeChatDatabase, 'user-1', 'workspace-1');

    await expect(service.globalPermission('agents:create' as any)).resolves.toBe(true);
    await expect(service.ownerPermission('agents:update' as any)).resolves.toBe(true);

    expect(mockGetScopePermissions).toHaveBeenNthCalledWith(1, 'agents:create', ['ALL']);
    expect(mockGetScopePermissions).toHaveBeenNthCalledWith(2, 'agents:update', ['OWNER']);
    expect(mockHasAnyPermission).toHaveBeenNthCalledWith(1, ['resolved-permission'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    expect(mockHasAnyPermission).toHaveBeenNthCalledWith(2, ['resolved-permission'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
  });

  it('scopes target provider ownership lookup to the active workspace', async () => {
    const findFirst = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const service = new TestService(
      { query: { aiProviders: { findFirst } } } as unknown as LobeChatDatabase,
      'user-1',
      'workspace-1',
    );
    mockHasAnyPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      service.operationPermission('aiProviders:update' as any, { targetProviderId: 'provider-1' }),
    ).resolves.toMatchObject({ condition: { userId: 'user-1' }, isPermitted: true });

    expect(mockBuildWorkspaceWhere).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      mockAiProviders,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('scopes target model ownership lookup to the active workspace', async () => {
    const findFirst = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const service = new TestService(
      { query: { aiModels: { findFirst } } } as unknown as LobeChatDatabase,
      'user-1',
      'workspace-1',
    );
    mockHasAnyPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      service.operationPermission('aiModels:update' as any, { targetModelId: 'model-1' }),
    ).resolves.toMatchObject({ condition: { userId: 'user-1' }, isPermitted: true });

    expect(mockBuildWorkspaceWhere).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      mockAiModels,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

/**
 * `getResourceBelongTo` answers `undefined` for two unrelated things — a row
 * that does not exist, and a row nobody owns. Collapsing them into "belongs to
 * someone else" made `POST /api/v1/chat` return 403 for every account that
 * held `ai_model:invoke:owner`, which is what personal accounts are given:
 * built-in models have no owner, so the ownership question had no true answer
 * and the absent answer was read as a denial.
 */
describe('BaseService.resolveOperationPermission ownership resolution', () => {
  const modelService = (owner: string | null | undefined) =>
    new TestService(
      {
        query: {
          aiModels: {
            findFirst: vi
              .fn()
              .mockResolvedValue(
                owner ? { userId: owner } : owner === null ? { userId: null } : undefined,
              ),
          },
        },
      } as unknown as LobeChatDatabase,
      'user-1',
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildWorkspaceWhere.mockReturnValue('workspace-where');
    // Distinguishable codes, so the grant below keys off WHICH scope was asked
    // for rather than the order the two checks happen to run in.
    mockGetScopePermissions.mockImplementation((key: string, scopes: string[]) => [
      `${key}:${scopes[0].toLowerCase()}`,
    ]);
  });

  const grants = ({ all = false, owner = false }) =>
    mockHasAnyPermission.mockImplementation(async (codes: string[]) =>
      codes.some((code) => (code.endsWith(':all') ? all : owner)),
    );

  it('lets an owner-scoped grant invoke a model nobody owns', async () => {
    grants({ owner: true });

    await expect(
      modelService(null).operationPermission('ai_model:invoke' as any, {
        targetModelId: 'builtin-model',
      }),
    ).resolves.toMatchObject({ condition: { userId: 'user-1' }, isPermitted: true });
  });

  it('pins the returned condition to the caller when no owner was resolved', async () => {
    grants({ owner: true });

    const result = await modelService(undefined).operationPermission('ai_model:invoke' as any, {
      targetModelId: 'missing-model',
    });

    // The condition scopes the follow-up query. An unresolved owner must never
    // widen it to "no filter" — that would hand back every user's rows.
    expect(result.condition).toEqual({ userId: 'user-1' });
  });

  it('still refuses a resource owned by somebody else', async () => {
    grants({ owner: true });

    await expect(
      modelService('user-2').operationPermission('ai_model:invoke' as any, {
        targetModelId: 'their-model',
      }),
    ).resolves.toMatchObject({ isPermitted: false });
  });

  it('still refuses an ALL-scope request without ALL permission', async () => {
    grants({ owner: true });

    await expect(
      modelService(null).operationPermission('ai_model:invoke' as any, 'all' as any),
    ).resolves.toMatchObject({ isPermitted: false });
  });

  it('refuses when the caller holds neither ALL nor OWNER', async () => {
    grants({});

    await expect(
      modelService(null).operationPermission('ai_model:invoke' as any, {
        targetModelId: 'builtin-model',
      }),
    ).resolves.toMatchObject({ isPermitted: false });
  });

  it('leaves the ALL-permission path untouched', async () => {
    grants({ all: true });

    await expect(
      modelService('user-2').operationPermission('ai_model:invoke' as any, {
        targetModelId: 'their-model',
      }),
    ).resolves.toMatchObject({ condition: { userId: 'user-2' }, isPermitted: true });
  });
});

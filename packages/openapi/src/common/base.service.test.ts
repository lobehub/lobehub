// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from './base.service';

const {
  mockBuildWorkspacePayload,
  mockBuildWorkspaceWhere,
  mockGetScopePermissions,
  mockHasAnyPermission,
} = vi.hoisted(() => ({
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
  aiModels: {},
  aiProviders: {},
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
});

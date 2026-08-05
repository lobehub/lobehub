import { RBAC_PERMISSIONS } from '@lobechat/const/rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  hasAnyPermission: vi.fn(),
  SkillImporter: vi.fn(),
}));

vi.mock('@lobechat/builtin-tool-skill-store', () => ({
  SkillStoreIdentifier: 'lobe-skill-store',
}));

vi.mock('@lobechat/builtin-tool-skill-store/executionRuntime', () => ({
  // Minimal stub so the factory can wrap the service without pulling the real
  // package runtime; the test only cares about how SkillImporter is constructed.
  SkillStoreExecutionRuntime: vi.fn(function (this: any, opts: any) {
    this.service = opts.service;
  }),
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: vi.fn(() => ({
    hasAnyPermission: mocks.hasAnyPermission,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({})),
}));

vi.mock('@/server/services/skill/importer', () => ({
  SkillImporter: mocks.SkillImporter,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(() => ({ scope: 'user', scopeKey: 'user-1' })),
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/policyStateStore', () => ({
  redisPolicyStateStore: {},
}));

describe('skillStoreRuntime', () => {
  const serverDB = {} as never;
  const scopedSkillWritePermissions = [
    RBAC_PERMISSIONS.AGENT_UPDATE_ALL,
    RBAC_PERMISSIONS.AGENT_UPDATE_OWNER,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    // Default: caller is allowed to manage workspace skills.
    mocks.hasAnyPermission.mockResolvedValue(true);
  });

  // Regression guard: importing a skill while running inside a workspace must
  // skill row is saved with `workspace_id = NULL` (the importer's personal
  // scope) and becomes invisible to the whole workspace — including the creator
  // whenever they operate in workspace mode.
  it('constructs SkillImporter with the workspaceId when the caller can manage workspace skills', async () => {
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.hasAnyPermission).toHaveBeenCalledWith(scopedSkillWritePermissions, {
      workspaceId: 'workspace-1',
    });
    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
  });

  // The skillStore runtime is reached via aiAgentWriteProcedure (message:create),
  // bypassing agentSkillsRouter's withScopedPermission('agent:update') gate. An
  // approve-only member must NOT be able to mutate the shared workspace skill
  // catalog by approving an import — it falls back to their personal scope.
  it('falls back to personal scope when the caller lacks the workspace skill-write permission', async () => {
    mocks.hasAnyPermission.mockResolvedValue(false);
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', undefined);
  });

  it('falls back to personal scope when the permission check throws', async () => {
    mocks.hasAnyPermission.mockRejectedValue(new Error('db down'));
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', undefined);
  });

  it('uses personal scope and skips the RBAC check outside a workspace', async () => {
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      toolManifestMap: {},
      userId: 'user-1',
    });

    expect(mocks.hasAnyPermission).not.toHaveBeenCalled();
    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', undefined);
  });
});

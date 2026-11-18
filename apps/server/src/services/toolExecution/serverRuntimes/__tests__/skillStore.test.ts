import { RBAC_PERMISSIONS } from '@lobechat/const/rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentConfigById: vi.fn(),
  getSkillDownloadUrl: vi.fn(),
  getUserSettings: vi.fn(),
  hasAnyPermission: vi.fn(),
  importFromUrl: vi.fn(),
  SkillImporter: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentConfigById: mocks.getAgentConfigById, updateConfig: mocks.updateConfig };
  }),
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
  RbacModel: vi.fn(function () {
    return {
      hasAnyPermission: mocks.hasAnyPermission,
    };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return {
      getUserSettings: mocks.getUserSettings,
    };
  }),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(function () {
    return { getSkillDownloadUrl: mocks.getSkillDownloadUrl };
  }),
}));

vi.mock('@/server/services/skill/importer', () => ({
  SkillImporter: mocks.SkillImporter,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn(),
  resolveToolOutcomeScope: vi.fn(function () {
    return { scope: 'user', scopeKey: 'user-1' };
  }),
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
    mocks.SkillImporter.mockImplementation(function () {
      return { importFromUrl: mocks.importFromUrl };
    });
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

  // The Skill Store UI and `lh skill install` store a market skill under its
  // market identifier. The agent tool used to derive one from the download URL
  // instead, so a skill already installed from the UI was not found and the
  // insert failed on the per-user name index with a raw "Failed query" error.
  it('imports a market skill under its market identifier', async () => {
    const downloadUrl =
      'https://market.lobehub.com/api/v1/skills/openclaw-skills-memory-setup/download';
    mocks.getSkillDownloadUrl.mockReturnValue(downloadUrl);
    mocks.importFromUrl.mockResolvedValue({
      skill: { id: 'skl_memory', name: 'memory-setup' },
      status: 'unchanged',
    });
    const { skillStoreRuntime } = await import('../skillStore');

    const runtime = (await skillStoreRuntime.factory({
      serverDB,
      toolManifestMap: {},
      userId: 'user-1',
    })) as any;
    const result = await runtime.service.importFromMarket('openclaw-skills-memory-setup');

    expect(mocks.importFromUrl).toHaveBeenCalledWith(
      { url: downloadUrl },
      { identifier: 'openclaw-skills-memory-setup', source: 'market' },
    );
    expect(result).toEqual({
      skill: { id: 'skl_memory', name: 'memory-setup' },
      status: 'unchanged',
    });
  });

  // A library skill is opt-in per agent, so a skill the model installs mid-run
  // would otherwise be off for the very agent that installed it.
  describe('turning an imported skill on for the run agent', () => {
    const importAs = async (agentId?: string) => {
      mocks.getSkillDownloadUrl.mockReturnValue('https://market.example/download');
      mocks.importFromUrl.mockResolvedValue({
        skill: { id: 'skl_1', identifier: 'excalidraw', name: 'excalidraw' },
        status: 'created',
      });
      const { skillStoreRuntime } = await import('../skillStore');
      const runtime = (await skillStoreRuntime.factory({
        agentId,
        serverDB,
        toolManifestMap: {},
        userId: 'user-1',
      })) as any;
      await runtime.service.importFromMarket('excalidraw');
    };

    it('sets the skill to auto for the agent that imported it', async () => {
      mocks.getAgentConfigById.mockResolvedValue({ plugins: ['lobe-web-browsing'] });

      await importAs('agent-1');

      expect(mocks.updateConfig).toHaveBeenCalledWith('agent-1', {
        plugins: ['lobe-web-browsing', { identifier: 'excalidraw', mode: 'auto' }],
      });
    });

    it('leaves an entry the user already chose alone', async () => {
      mocks.getAgentConfigById.mockResolvedValue({
        plugins: [{ identifier: 'excalidraw', mode: 'disabled' }],
      });

      await importAs('agent-1');

      expect(mocks.updateConfig).not.toHaveBeenCalled();
    });

    it('does nothing when the import has no agent', async () => {
      await importAs();

      expect(mocks.getAgentConfigById).not.toHaveBeenCalled();
      expect(mocks.updateConfig).not.toHaveBeenCalled();
    });
  });
});

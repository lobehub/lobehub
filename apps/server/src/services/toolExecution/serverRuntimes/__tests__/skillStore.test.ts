import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
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

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
  });

  // Regression guard for LOBE-10893: importing a skill while running inside a
  // workspace must construct SkillImporter WITH the workspaceId, otherwise the
  // skill row is saved with `workspace_id = NULL` (the importer's personal
  // scope) and becomes invisible to the whole workspace — including the creator
  // whenever they operate in workspace mode.
  it('constructs SkillImporter with the workspaceId when running in a workspace', async () => {
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
  });

  it('falls back to personal scope (undefined workspaceId) outside a workspace', async () => {
    const { skillStoreRuntime } = await import('../skillStore');

    await skillStoreRuntime.factory({
      serverDB,
      userId: 'user-1',
    });

    expect(mocks.SkillImporter).toHaveBeenCalledWith(serverDB, 'user-1', undefined);
  });
});

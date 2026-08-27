import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOwnerPrincipal, resolveRunPrincipal } from '@/server/services/executionPrincipal';

const mocks = vi.hoisted(() => ({
  emitToolOutcomeSafely: vi.fn().mockResolvedValue(undefined),
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  getAgentConfigById: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(() => ({
    getAgentConfigById: mocks.getAgentConfigById,
  })),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findAll: mocks.findAll,
    findById: mocks.findById,
    findByName: mocks.findByName,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn((skills: unknown) => skills),
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: mocks.emitToolOutcomeSafely,
  resolveToolOutcomeScope: vi.fn(() => ({ scope: 'agent', scopeKey: 'agent-1' })),
}));

vi.mock('@/server/services/agentSignal/store/adapters/redis/policyStateStore', () => ({
  redisPolicyStateStore: {},
}));

describe('activatorRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentConfigById.mockResolvedValue({ plugins: [] });
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.findByName.mockResolvedValue(undefined);
  });

  describe('activateSkill — disabled skill enforcement', () => {
    // First dynamic `import('../activator')` in the file pays the real
    // transform cost for this module — default 5s timeout is marginal for
    // that cold cost alone, independent of test logic.
    it('refuses to activate a DB skill the agent has disabled, even though it exists', async () => {
      mocks.getAgentConfigById.mockResolvedValue({
        plugins: [{ identifier: 'user-skill-identifier', mode: 'disabled' }],
      });
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? {
              content: '# User skill',
              id: 'user-skill-id',
              identifier: 'user-skill-identifier',
              name: 'user-skill',
            }
          : undefined,
      );

      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        principal: createOwnerPrincipal('user-1'),
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(false);
    }, 20_000);

    it('still activates the skill when it is not disabled', async () => {
      mocks.getAgentConfigById.mockResolvedValue({ plugins: [] });
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? {
              content: '# User skill',
              id: 'user-skill-id',
              identifier: 'user-skill-identifier',
              name: 'user-skill',
            }
          : undefined,
      );

      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        principal: createOwnerPrincipal('user-1'),
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
    });
  });

  describe('activateSkill — agent share allowlist enforcement', () => {
    beforeEach(() => {
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? {
              content: '# User skill',
              id: 'user-skill-id',
              identifier: 'user-skill-identifier',
              name: 'user-skill',
            }
          : undefined,
      );
    });

    it('refuses to activate a skill outside the share allowlist', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        principal: resolveRunPrincipal({
          agentShare: {
            agentId: 'agent-1',
            enabledToolIds: ['some-other-skill-identifier'],
            shareId: 'share-1',
            visitorUserId: 'visitor-1',
          },
          userId: 'creator-1',
        }),
        serverDB: {} as never,
        toolManifestMap: {},
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(false);
    }, 20_000);

    it('refuses to activate any skill when the share allowlist is empty', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        principal: resolveRunPrincipal({
          agentShare: {
            agentId: 'agent-1',
            enabledToolIds: [],
            shareId: 'share-1',
            visitorUserId: 'visitor-1',
          },
          userId: 'creator-1',
        }),
        serverDB: {} as never,
        toolManifestMap: {},
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(false);
    });

    it('activates a skill included in the share allowlist', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        principal: resolveRunPrincipal({
          agentShare: {
            agentId: 'agent-1',
            enabledToolIds: ['user-skill-identifier'],
            shareId: 'share-1',
            visitorUserId: 'visitor-1',
          },
          userId: 'creator-1',
        }),
        serverDB: {} as never,
        toolManifestMap: {},
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
    });

    it('activates a skill normally when the run is not a share (no agentShare context)', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        principal: createOwnerPrincipal('user-1'),
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
    });
  });

  describe('activateSkill — Agent Signal suppression for share visitors', () => {
    beforeEach(() => {
      mocks.findByName.mockImplementation(async (name: string) =>
        name === 'user-skill'
          ? {
              content: '# User skill',
              id: 'user-skill-id',
              identifier: 'user-skill-identifier',
              name: 'user-skill',
            }
          : undefined,
      );
    });

    /**
     * Regression test: `emitActivationOutcome` must forward the
     * run's delegation into `emitToolOutcomeSafely` so the choke point in
     * `emitToolOutcome.ts` (`agentShare` presence check) can suppress the
     * write — otherwise a successful visitor `activateSkill` call would write
     * creator-scoped procedure state / reach self-reflection under the
     * resource owner (the share creator), never the visitor.
     */
    it('forwards the agentShare marker so the activation outcome cannot enter Agent Signal', async () => {
      const { activatorRuntime } = await import('../activator');
      const agentShare = {
        agentId: 'agent-1',
        enabledToolIds: ['user-skill-identifier'],
        shareId: 'share-1',
        visitorUserId: 'visitor-1',
      };
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        principal: resolveRunPrincipal({ agentShare, userId: 'creator-1' }),
        serverDB: {} as never,
        toolManifestMap: {},
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
      // Downstream still takes the legacy `{ agentId, visitorUserId }` pair —
      // `toDelegationMarker` is the single adapter that produces it.
      expect(mocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          agentShare: { agentId: 'agent-1', visitorUserId: 'visitor-1' },
        }),
      );
    });

    it('omits the agentShare marker for a non-share run', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        serverDB: {} as never,
        toolManifestMap: {},
        principal: createOwnerPrincipal('user-1'),
      });

      await runtime.activateSkill({ name: 'user-skill' });

      expect(mocks.emitToolOutcomeSafely).toHaveBeenCalledWith(
        expect.objectContaining({ agentShare: undefined }),
      );
    });
  });
});

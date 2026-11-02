import type { LobeToolManifest } from '@lobechat/context-engine';
import { buildAtomicCapabilityBundle } from '@lobechat/context-engine/onDemand';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  getAgentConfigById: vi.fn(),
  getConnectorToolPermission: vi.fn(),
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

vi.mock('@/libs/mcp/connectorPermissionCheck', () => ({
  getConnectorToolPermission: mocks.getConnectorToolPermission,
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn().mockResolvedValue(undefined),
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
    mocks.getConnectorToolPermission.mockResolvedValue(null);
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
        userId: 'user-1',
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
        userId: 'user-1',
      });

      const result = await runtime.activateSkill({ name: 'user-skill' });

      expect(result.success).toBe(true);
    });
  });

  describe('on-demand atomic activation', () => {
    const manifest: LobeToolManifest = {
      api: [
        {
          description: 'Deploy a release',
          name: 'deploy',
          parameters: {
            properties: { version: { type: 'string' } },
            required: ['version'],
            type: 'object',
          },
        },
      ],
      identifier: 'release-tool',
      meta: { description: 'Release operations', title: 'Release Tool' },
      systemRole: 'Use the native deployment contract.',
      type: 'default',
    };

    const createPool = () => {
      const bundle = buildAtomicCapabilityBundle({
        execution: { environment: 'server', transport: 'builtin-native' },
        identifier: manifest.identifier,
        manifest,
        permissions: {
          grants: [
            {
              principal: { id: 'agent-1', type: 'agent' },
              scopes: ['tool:execute', 'api:deploy'],
            },
          ],
          sharedAuthorizations: [],
        },
        sourceRuntime: { runtime: 'server', source: 'builtin' },
      });

      return {
        bundles: { [manifest.identifier]: bundle },
        cards: [
          {
            capability: 'Release operations',
            executionEnvironment: 'server' as const,
            hash: bundle.hash,
            identifier: manifest.identifier,
            name: 'Release Tool',
            source: 'builtin' as const,
            version: bundle.version,
          },
        ],
        hash: 'pool-hash',
        version: '1' as const,
      };
    };

    it('loads a validated native manifest and exposes the full manual', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        contextMode: 'on-demand',
        discoveryPool: createPool(),
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['release-tool'] });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Use the native deployment contract.');
      expect(result.content).toContain('"name": "deploy"');
      expect(result.state).toMatchObject({
        activatedTools: [
          {
            capability: {
              identifier: 'release-tool',
            },
            capabilitySummary: 'Release operations',
            executionEnvironment: 'server',
            identifier: 'release-tool',
            name: 'Release Tool',
            source: 'builtin',
          },
        ],
      });
    });

    it('refuses a connector tool disabled by user permission and leaks no manifest', async () => {
      mocks.getConnectorToolPermission.mockResolvedValue('disabled');
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        contextMode: 'on-demand',
        discoveryPool: createPool(),
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['release-tool'] });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Not found: release-tool');
      expect(result.state).toMatchObject({
        activatedTools: [],
        notFound: ['release-tool'],
      });
    });

    it('refuses version drift between the card and atomic bundle', async () => {
      const pool = createPool();
      const driftedPool = {
        ...pool,
        cards: [{ ...pool.cards[0], version: 'drifted-version' }],
      };
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        agentId: 'agent-1',
        contextMode: 'on-demand',
        discoveryPool: driftedPool,
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['release-tool'] });

      expect(result.success).toBe(false);
      expect(result.state).toMatchObject({
        activatedTools: [],
        notFound: ['release-tool'],
      });
    });
  });
});

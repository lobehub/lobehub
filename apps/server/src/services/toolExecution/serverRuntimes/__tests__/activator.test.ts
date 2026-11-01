import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  getAgentConfigById: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return {
      getAgentConfigById: mocks.getAgentConfigById,
    };
  }),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(function () {
    return {
      findAll: mocks.findAll,
      findById: mocks.findById,
      findByName: mocks.findByName,
    };
  }),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn(function (skills: unknown) {
    return skills;
  }),
}));

vi.mock('@/server/services/agentSignal/procedure', () => ({
  emitToolOutcomeSafely: vi.fn().mockResolvedValue(undefined),
  resolveToolOutcomeScope: vi.fn(function () {
    return { scope: 'agent', scopeKey: 'agent-1' };
  }),
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
  describe('activateTools — device picker on a locked run', () => {
    it.each([
      {
        expected: 'locked to device "device-a"',
        plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
      },
      {
        expected: 'bound device, which is offline',
        plan: { kind: 'device-unrouted', reason: 'bound-device-offline', target: 'local' },
      },
    ] as const)(
      'says why the picker is missing instead of a bare "Not found" ($plan.kind)',
      async ({ expected, plan }) => {
        const { activatorRuntime } = await import('../activator');
        const runtime = await activatorRuntime.factory({
          executionPlan: plan,
          serverDB: {} as never,
          toolManifestMap: {},
          userId: 'user-1',
        });

        const result = await runtime.activateTools({ identifiers: ['lobe-remote-device'] });

        expect(result.content).toContain('Not available: lobe-remote-device.');
        expect(result.content).toContain(expected);
        expect(result.content).toContain('device selector');
        expect(result.content).not.toContain('Not found');
      },
      20_000,
    );

    it('keeps "Not found" when the picker was withheld for another reason', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        executionPlan: { kind: 'sandbox', target: 'sandbox' },
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['lobe-remote-device'] });

      expect(result.content).toContain('Not found: lobe-remote-device');
    });
  });

  describe('activateTools — wire-name resolution', () => {
    // Production vent: the model requested `lobe-web-browsing____search` — the
    // wire name from `tools[]` — while the manifest map is keyed by the plugin
    // identifier. Activation must resolve it instead of a bare "Not found"
    // that the model then retried until it vented.
    const webBrowsingManifest = {
      api: [
        { name: 'search', parameters: {} },
        { name: 'crawlSinglePage', parameters: {} },
      ],
      identifier: 'lobe-web-browsing',
      meta: { title: 'Web Browsing' },
      type: 'builtin',
    } as never;

    it('activates a tool requested by its wire name (identifier____apiName)', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: { 'lobe-web-browsing': webBrowsingManifest },
        userId: 'user-1',
      });

      const result = await runtime.activateTools({
        identifiers: ['lobe-web-browsing____search'],
      });

      expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
      expect(result.state?.notFound).toEqual([]);
    }, 20_000);

    it('activates a tool requested by a wire name with an MD5-compressed api segment', async () => {
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: { 'lobe-web-browsing': webBrowsingManifest },
        userId: 'user-1',
      });

      const result = await runtime.activateTools({
        identifiers: ['lobe-web-browsing____MD5HASH_abc123def456'],
      });

      expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
      expect(result.state?.notFound).toEqual([]);
    }, 20_000);

    it('activates a tool whose wire name carries an MD5-compressed identifier segment via the discoverable list', async () => {
      // Codex P2 on PR #20791: a hashed identifier segment cannot be probed
      // against the identifier-keyed `toolManifestMap`; the runtime must use
      // the host's discoverable list and match hashed wire-name variants
      // locally (mirror of `ToolNameResolver.generate`).
      const { Md5 } = await import('ts-md5');
      const wireHash = (segment: string) =>
        `MD5HASH_${Md5.hashStr(segment).toString().slice(0, 12)}`;
      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: { 'lobe-web-browsing': webBrowsingManifest },
        userId: 'user-1',
      });

      const result = await runtime.activateTools({
        identifiers: [`${wireHash('lobe-web-browsing')}____${wireHash('search')}`],
      });

      expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
      expect(result.state?.notFound).toEqual([]);
    }, 20_000);
  });

  describe('Agent Share visitor runs', () => {
    const userSkill = {
      content: '# User skill',
      id: 'user-skill-id',
      identifier: 'user-skill-identifier',
      name: 'user-skill',
    };

    const createVisitorRuntime = async (
      agentShareVisitor: { skillGrants?: string[]; toolGrants?: { identifier: string }[] },
      toolManifestMap: Record<string, unknown> = {},
    ) => {
      const { activatorRuntime } = await import('../activator');
      return activatorRuntime.factory({
        agentId: 'agent-1',
        agentShareVisitor: agentShareVisitor as never,
        serverDB: {} as never,
        toolManifestMap: toolManifestMap as never,
        userId: 'creator-1',
      });
    };

    it('does not open a skill the share did not grant through the activateTools fallback', async () => {
      mocks.findByName.mockImplementation(async (name: string) =>
        name === userSkill.name ? userSkill : undefined,
      );
      mocks.findById.mockImplementation(async (id: string) =>
        id === userSkill.id ? userSkill : undefined,
      );
      mocks.findAll.mockResolvedValue({ data: [userSkill], total: 1 });

      const runtime = await createVisitorRuntime({
        skillGrants: ['another-skill'],
        toolGrants: [{ identifier: 'lobe-calculator' }],
      });

      const result = await runtime.activateTools({
        identifiers: [userSkill.name],
        reason: 'test',
      });

      expect(result.content).toContain(`Not found: ${userSkill.name}`);
      expect(result.content).not.toContain(userSkill.content);
      expect(result.state?.activatedSkills).toEqual([]);
    }, 20_000);

    it('opens a skill the share granted', async () => {
      mocks.findByName.mockImplementation(async (name: string) =>
        name === userSkill.name ? userSkill : undefined,
      );

      const runtime = await createVisitorRuntime({
        skillGrants: [userSkill.identifier],
        toolGrants: [{ identifier: 'lobe-calculator' }],
      });

      const result = await runtime.activateTools({
        identifiers: [userSkill.name],
        reason: 'test',
      });

      expect(result.content).toContain(userSkill.content);
      expect(result.content).not.toContain('Not found');
    });

    it('activates only tools present in the gated manifest map', async () => {
      // The share gate already pruned this map; an ungranted tool is simply
      // absent, so naming it cannot pull its manifest into the run.
      const runtime = await createVisitorRuntime(
        { toolGrants: [{ identifier: 'lobe-calculator' }] },
        {
          'lobe-calculator': {
            api: [{ description: 'Calculate', name: 'calculate' }],
            identifier: 'lobe-calculator',
            meta: { title: 'Calculator' },
          },
        },
      );

      const result = await runtime.activateTools({
        identifiers: ['lobe-calculator', 'lobe-agent-management'],
        reason: 'test',
      });

      expect(result.state?.activatedTools.map((tool: any) => tool.identifier)).toEqual([
        'lobe-calculator',
      ]);
      expect(result.state?.notFound).toEqual(['lobe-agent-management']);
    });
  });

  describe('activateTools — installed-but-not-pinned plugins', () => {
    // The run's discovery pool is what feeds `toolManifestMap`; an installed
    // plugin the agent never pinned must be resolvable from it even though it
    // is absent from `enabledToolIds`.
    const mcpManifest = {
      api: [{ description: 'Send a message to a Feishu chat', name: 'sendMessage' }],
      identifier: 'tituwork-feishu-mcp',
      meta: { title: 'Feishu MCP' },
      type: 'mcp',
    };

    it('activates a plugin the run only discovered, and reports the APIs it unlocked', async () => {
      const { resolveDiscoveryPool } = await import('@lobechat/mecha');
      const pool = resolveDiscoveryPool({
        builtinTools: [],
        enabledManifests: new Map(),
        executionTarget: 'none',
        installedManifests: [mcpManifest as never],
      });

      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: pool.manifestMap,
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['tituwork-feishu-mcp'] });

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        'Successfully activated tools: tituwork-feishu-mcp.sendMessage',
      );
      expect(result.state.notFound).toEqual([]);
    }, 20_000);

    it('still answers "Not found" for a plugin the run disabled', async () => {
      const { resolveDiscoveryPool } = await import('@lobechat/mecha');
      const pool = resolveDiscoveryPool({
        builtinTools: [],
        disabledPluginIds: [mcpManifest.identifier],
        enabledManifests: new Map(),
        executionTarget: 'none',
        installedManifests: [mcpManifest as never],
      });
      expect(pool.manifestMap).toEqual({});

      const { activatorRuntime } = await import('../activator');
      const runtime = await activatorRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: pool.manifestMap,
        userId: 'user-1',
      });

      const result = await runtime.activateTools({ identifiers: ['tituwork-feishu-mcp'] });

      expect(result.content).toContain('Not found: tituwork-feishu-mcp');
      expect(result.content).not.toContain('Successfully activated');
    }, 20_000);
  });
});

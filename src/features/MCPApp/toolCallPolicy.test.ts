import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppToolCallPolicy } from './toolCallPolicy';

const { agentTools, connectors, plugins, toolStore, userIntervention } = vi.hoisted(() => {
  // The agent's own connectors on the server, and which agents the client has loaded
  const agentTools = new Map<string, Map<string, unknown>>();
  const loaded = new Set<string>();

  return {
    agentTools,
    connectors: new Map<string, unknown>(),
    plugins: new Map<string, unknown>(),
    toolStore: {
      ensureAgentConnectors: vi.fn(async (agentId: string) => {
        loaded.add(agentId);
      }),
      loaded,
    },
    userIntervention: { allowList: [] as string[], approvalMode: 'manual' },
  };
});

vi.mock('@/store/tool', () => ({ getToolStoreState: () => toolStore }));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: (id: string) => () => plugins.get(id),
  },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorByIdentifierForAgent: (id: string, agentId?: string) => () =>
      (agentId && toolStore.loaded.has(agentId) ? agentTools.get(agentId)?.get(id) : undefined) ??
      connectors.get(id),
    isAgentConnectorsInit: (agentId: string) => () => toolStore.loaded.has(agentId),
  },
}));

vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));

vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: {
    allowList: () => userIntervention.allowList,
    approvalMode: () => userIntervention.approvalMode,
  },
}));

const connector = (permission: string) => ({
  isEnabled: true,
  mcpServerUrl: 'https://mcp.example.com/mcp',
  tools: [{ permission, toolName: 'send' }],
});

const plugin = (humanIntervention?: unknown) => ({
  manifest: { api: [{ humanIntervention, name: 'send' }] },
});

describe('getAppToolCallPolicy', () => {
  beforeEach(() => {
    agentTools.clear();
    connectors.clear();
    plugins.clear();
    toolStore.loaded.clear();
    toolStore.ensureAgentConnectors.mockClear();
    userIntervention.allowList = [];
    userIntervention.approvalMode = 'manual';
  });

  describe('manual mode follows the tool setting', () => {
    it('asks before running a connector tool that needs approval', async () => {
      connectors.set('mail', connector('needs_approval'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
    });

    it('runs auto connector tools and refuses disabled or unknown ones', async () => {
      connectors.set('mail', connector('auto'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');
      expect(await getAppToolCallPolicy('mail', 'delete')).toBe('deny');

      connectors.set('mail', connector('disabled'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('deny');
    });

    it('follows the plugin manifest humanIntervention', async () => {
      plugins.set('weather', plugin('required'));
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');

      plugins.set('weather', plugin('never'));
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('allow');

      plugins.set('weather', plugin());
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('allow');
      expect(await getAppToolCallPolicy('weather', 'other')).toBe('deny');
    });

    it('runs an allow-listed tool without asking', async () => {
      connectors.set('mail', connector('needs_approval'));
      userIntervention.allowList = ['mail/send'];

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('asks for an agent tool the client has not loaded, refuses anything else unknown', async () => {
      expect(await getAppToolCallPolicy('agent-app', 'send', { agentId: 'agt_1' })).toBe('confirm');
      expect(await getAppToolCallPolicy('agent-app', 'send')).toBe('deny');
    });
  });

  describe('MCP Apps tool visibility', () => {
    it('lets a view call a plugin tool kept from the model, under its own setting', async () => {
      plugins.set('weather', {
        manifest: {
          api: [{ name: 'forecast' }],
          mcpAppOnlyApi: [
            { humanIntervention: 'required', name: 'load_page' },
            { name: 'refresh' },
          ],
        },
      });

      expect(await getAppToolCallPolicy('weather', 'load_page')).toBe('confirm');
      expect(await getAppToolCallPolicy('weather', 'refresh')).toBe('allow');
    });

    it('refuses a view a plugin tool only the model may call', async () => {
      plugins.set('weather', {
        manifest: { api: [{ name: 'delete_all' }], mcpModelOnlyTools: ['delete_all'] },
      });

      expect(await getAppToolCallPolicy('weather', 'delete_all')).toBe('deny');
    });

    it('refuses a view a connector tool only the model may call', async () => {
      connectors.set('mail', {
        ...connector('auto'),
        tools: [{ metadata: { visibility: ['model'] }, permission: 'auto', toolName: 'send' }],
      });

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('deny');
    });

    it('lets a view call a connector tool kept from the model', async () => {
      connectors.set('mail', {
        ...connector('auto'),
        tools: [{ metadata: { visibility: ['app'] }, permission: 'auto', toolName: 'send' }],
      });

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });
  });

  describe('agent-owned connectors', () => {
    it("loads the agent's tools before judging, so its stricter copy decides", async () => {
      connectors.set('mail', connector('auto'));
      agentTools.set('agt_1', new Map([['mail', connector('needs_approval')]]));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('confirm');
      expect(toolStore.ensureAgentConnectors).toHaveBeenCalledWith('agt_1');
    });

    it('uses the base connector once the agent turns out to have no copy of it', async () => {
      connectors.set('mail', connector('auto'));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('allow');
    });

    it("asks when the agent's tools can't be loaded rather than trust the base connector", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      connectors.set('mail', connector('auto'));
      toolStore.ensureAgentConnectors.mockRejectedValueOnce(new Error('offline'));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('confirm');
    });
  });

  describe('allow-list mode', () => {
    beforeEach(() => {
      userIntervention.approvalMode = 'allow-list';
    });

    it('asks before a tool that is not on the allow-list, even one set to run automatically', async () => {
      connectors.set('mail', connector('auto'));
      plugins.set('weather', plugin());

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });

    it('runs a tool on the allow-list', async () => {
      connectors.set('mail', connector('needs_approval'));
      userIntervention.allowList = ['mail/send'];

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('still refuses a tool the server does not offer', async () => {
      connectors.set('mail', connector('auto'));
      userIntervention.allowList = ['mail/delete'];

      expect(await getAppToolCallPolicy('mail', 'delete')).toBe('deny');
    });
  });

  describe('auto-run mode', () => {
    beforeEach(() => {
      userIntervention.approvalMode = 'auto-run';
    });

    it('runs tools that would ask in manual mode', async () => {
      connectors.set('mail', connector('needs_approval'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('still asks for a tool whose policy is always', async () => {
      plugins.set('weather', plugin('always'));
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });
  });

  it('asks for arguments the security blacklist matches, in every mode', async () => {
    connectors.set('shell', {
      ...connector('auto'),
      tools: [{ permission: 'auto', toolName: 'run' }],
    });
    userIntervention.allowList = ['shell/run'];
    const toolArgs = { command: 'rm -rf ~/' };

    for (const mode of ['manual', 'allow-list', 'auto-run']) {
      userIntervention.approvalMode = mode;
      expect(await getAppToolCallPolicy('shell', 'run', { toolArgs })).toBe('confirm');
    }
    expect(await getAppToolCallPolicy('shell', 'run', { toolArgs: { command: 'ls' } })).toBe(
      'allow',
    );
  });
});

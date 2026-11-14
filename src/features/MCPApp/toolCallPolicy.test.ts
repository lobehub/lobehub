import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppToolCallPolicy } from './toolCallPolicy';

const { agentTools, connectors, plugins, toolStore, userIntervention } = vi.hoisted(() => {
  // The agent's own connectors on the server, and which lists the server confirmed
  const agentTools = new Map<string, Map<string, unknown>>();
  const loaded = new Set<string>();

  return {
    agentTools,
    connectors: new Map<string, unknown>(),
    plugins: new Map<string, unknown>(),
    toolStore: {
      ensureConfirmedConnectors: vi.fn(async (agentId?: string) => {
        loaded.add('#base');
        if (agentId) loaded.add(agentId);
      }),
      isConnectorListConfirmed: (agentId?: string) =>
        loaded.has('#base') && (!agentId || loaded.has(agentId)),
      loaded,
      syncConnectorTools: vi.fn(async (_id: string) => {}),
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
    toolStore.ensureConfirmedConnectors.mockClear();
    toolStore.syncConnectorTools.mockClear();
    userIntervention.allowList = [];
    userIntervention.approvalMode = 'manual';
  });

  describe('manual mode follows the tool setting', () => {
    it('asks before running a connector tool that needs approval', async () => {
      connectors.set('mail', connector('needs_approval'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
    });

    it('runs auto connector tools and refuses disabled or unknown ones', async () => {
      connectors.set('mail', { ...connector('auto'), id: 'conn_mail_unknown' });
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

    it('asks about a plugin tool its stored manifest lacks, as one stored before MCP Apps would', async () => {
      plugins.set('weather', plugin());
      expect(await getAppToolCallPolicy('weather', 'load_page')).toBe('confirm');

      // Still refused once its connector disabled it
      connectors.set('weather', { tools: [{ permission: 'disabled', toolName: 'load_page' }] });
      expect(await getAppToolCallPolicy('weather', 'load_page')).toBe('deny');
    });

    it('refuses a view a plugin tool only the model may call', async () => {
      plugins.set('weather', {
        manifest: { api: [{ name: 'delete_all' }], mcpModelOnlyTools: ['delete_all'] },
      });

      expect(await getAppToolCallPolicy('weather', 'delete_all')).toBe('deny');
    });

    it("syncs a connector's tools again, once, for a tool its list synced before MCP Apps lacks", async () => {
      connectors.set('stdio-app', { ...connector('auto'), id: 'conn_stdio' });
      toolStore.syncConnectorTools.mockImplementationOnce(async () => {
        connectors.set('stdio-app', {
          ...connector('auto'),
          id: 'conn_stdio',
          tools: [
            { permission: 'auto', toolName: 'send' },
            { metadata: { visibility: ['app'] }, permission: 'auto', toolName: 'load_page' },
          ],
        });
      });

      expect(await getAppToolCallPolicy('stdio-app', 'load_page')).toBe('allow');
      expect(toolStore.syncConnectorTools).toHaveBeenCalledWith('conn_stdio');

      // A tool the server doesn't offer at all is refused, without syncing again
      expect(await getAppToolCallPolicy('stdio-app', 'missing')).toBe('deny');
      expect(toolStore.syncConnectorTools).toHaveBeenCalledTimes(1);
    });

    it('lets parallel view calls wait for the same resync instead of refusing the later ones', async () => {
      connectors.set('parallel-app', { ...connector('auto'), id: 'conn_parallel' });
      let finish!: () => void;
      toolStore.syncConnectorTools.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              connectors.set('parallel-app', {
                ...connector('auto'),
                id: 'conn_parallel',
                tools: ['load_page', 'load_more'].map((toolName) => ({
                  metadata: { visibility: ['app'] },
                  permission: 'auto',
                  toolName,
                })),
              });
              resolve();
            };
          }),
      );

      const first = getAppToolCallPolicy('parallel-app', 'load_page');
      const second = getAppToolCallPolicy('parallel-app', 'load_more');
      await vi.waitFor(() => expect(toolStore.syncConnectorTools).toHaveBeenCalledTimes(1));
      finish();

      expect(await first).toBe('allow');
      expect(await second).toBe('allow');
      expect(toolStore.syncConnectorTools).toHaveBeenCalledTimes(1);
    });

    it('tries a failed resync again on the next call', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      connectors.set('flaky-app', { ...connector('auto'), id: 'conn_flaky' });
      toolStore.syncConnectorTools.mockRejectedValueOnce(new Error('offline'));
      expect(await getAppToolCallPolicy('flaky-app', 'load_page')).toBe('deny');

      toolStore.syncConnectorTools.mockImplementationOnce(async () => {
        connectors.set('flaky-app', {
          ...connector('auto'),
          id: 'conn_flaky',
          tools: [{ metadata: { visibility: ['app'] }, permission: 'auto', toolName: 'load_page' }],
        });
      });
      expect(await getAppToolCallPolicy('flaky-app', 'load_page')).toBe('allow');
      expect(toolStore.syncConnectorTools).toHaveBeenCalledTimes(2);
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

  describe("a plugin's connector permissions", () => {
    // syncPluginTools keeps a marketplace plugin's permissions on a connector with no endpoint
    const permissionsOnly = (permission: string) => ({
      isEnabled: true,
      tools: [{ permission, toolName: 'send' }],
    });

    it('asks before a plugin tool its connector marks as needing approval', async () => {
      plugins.set('weather', plugin());
      connectors.set('weather', permissionsOnly('needs_approval'));

      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });

    it('refuses a plugin tool its connector disabled', async () => {
      plugins.set('weather', plugin());
      connectors.set('weather', permissionsOnly('disabled'));

      expect(await getAppToolCallPolicy('weather', 'send')).toBe('deny');
    });

    it("asks about a plugin tool while the connector permissions aren't confirmed", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      plugins.set('weather', plugin());
      toolStore.ensureConfirmedConnectors.mockRejectedValueOnce(new Error('offline'));

      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });
  });

  describe('agent-owned connectors', () => {
    it("loads the agent's tools before judging, so its stricter copy decides", async () => {
      connectors.set('mail', connector('auto'));
      agentTools.set('agt_1', new Map([['mail', connector('needs_approval')]]));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('confirm');
      expect(toolStore.ensureConfirmedConnectors).toHaveBeenCalledWith('agt_1', {
        revalidate: true,
      });
    });

    it('uses the base connector once the agent turns out to have no copy of it', async () => {
      connectors.set('mail', connector('auto'));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('allow');
    });

    it("asks when the agent's tools can't be loaded rather than trust the base connector", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      connectors.set('mail', connector('auto'));
      toolStore.ensureConfirmedConnectors.mockRejectedValueOnce(new Error('offline'));

      expect(await getAppToolCallPolicy('mail', 'send', { agentId: 'agt_1' })).toBe('confirm');
    });

    it('reloads the permissions for every call, asking when they changed since the view opened', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      connectors.set('mail', connector('auto'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('allow');

      // Tightened elsewhere (another tab, another workspace member)
      toolStore.ensureConfirmedConnectors.mockImplementationOnce(async () => {
        connectors.set('mail', connector('needs_approval'));
      });
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');

      // Confirmed earlier, but unreachable now: the earlier answer can't waive approval
      connectors.set('mail', connector('auto'));
      toolStore.ensureConfirmedConnectors.mockRejectedValueOnce(new Error('offline'));
      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
      expect(toolStore.ensureConfirmedConnectors).toHaveBeenCalledTimes(3);
    });

    it('asks while the only permissions it has were painted from storage', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // The stored list says auto; the server, which can't be reached, may say otherwise
      connectors.set('mail', connector('auto'));
      toolStore.ensureConfirmedConnectors.mockRejectedValueOnce(new Error('offline'));

      expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
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

    // A cloud marketplace MCP the market marks `always`: the connector's
    // three-state permission alone would let auto-run through
    it('still asks for a connector tool its manifest made mandatory, whatever its permission', async () => {
      for (const permission of ['needs_approval', 'auto']) {
        connectors.set('mail', {
          ...connector(permission),
          tools: [{ metadata: { mandatoryApproval: true }, permission, toolName: 'send' }],
        });
        expect(await getAppToolCallPolicy('mail', 'send')).toBe('confirm');
      }
    });

    it("keeps a plugin tool's own always when its connector marks it as needing approval", async () => {
      plugins.set('weather', plugin('always'));
      connectors.set('weather', {
        isEnabled: true,
        tools: [{ permission: 'needs_approval', toolName: 'send' }],
      });
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');

      plugins.set('weather', plugin('required'));
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('allow');
    });

    // An unfinished marketplace reinstall over a plugin row: the call runs the
    // plugin (`invokeMcpToolCall`), so the plugin's own `always` decides
    it('judges an unfinished marketplace reinstall by the plugin it falls back to', async () => {
      plugins.set('weather', plugin('always'));
      connectors.set('weather', {
        ...connector('needs_approval'),
        sourceType: 'marketplace',
        status: 'disconnected',
      });
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('confirm');

      // Once the reinstall finishes, the connector it routes to decides
      connectors.set('weather', {
        ...connector('needs_approval'),
        sourceType: 'marketplace',
        status: 'connected',
      });
      expect(await getAppToolCallPolicy('weather', 'send')).toBe('allow');
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

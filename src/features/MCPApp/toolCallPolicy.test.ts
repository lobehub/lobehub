import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppToolCallPolicy } from './toolCallPolicy';

const { connectors, plugins, userIntervention } = vi.hoisted(() => ({
  connectors: new Map<string, unknown>(),
  plugins: new Map<string, unknown>(),
  userIntervention: { allowList: [] as string[], approvalMode: 'manual' },
}));

vi.mock('@/store/tool', () => ({ getToolStoreState: () => ({}) }));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: (id: string) => () => plugins.get(id),
  },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorByIdentifierForAgent: (id: string) => () => connectors.get(id),
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
    connectors.clear();
    plugins.clear();
    userIntervention.allowList = [];
    userIntervention.approvalMode = 'manual';
  });

  describe('manual mode follows the tool setting', () => {
    it('asks before running a connector tool that needs approval', () => {
      connectors.set('mail', connector('needs_approval'));
      expect(getAppToolCallPolicy('mail', 'send')).toBe('confirm');
    });

    it('runs auto connector tools and refuses disabled or unknown ones', () => {
      connectors.set('mail', connector('auto'));
      expect(getAppToolCallPolicy('mail', 'send')).toBe('allow');
      expect(getAppToolCallPolicy('mail', 'delete')).toBe('deny');

      connectors.set('mail', connector('disabled'));
      expect(getAppToolCallPolicy('mail', 'send')).toBe('deny');
    });

    it('follows the plugin manifest humanIntervention', () => {
      plugins.set('weather', plugin('required'));
      expect(getAppToolCallPolicy('weather', 'send')).toBe('confirm');

      plugins.set('weather', plugin('never'));
      expect(getAppToolCallPolicy('weather', 'send')).toBe('allow');

      plugins.set('weather', plugin());
      expect(getAppToolCallPolicy('weather', 'send')).toBe('allow');
      expect(getAppToolCallPolicy('weather', 'other')).toBe('deny');
    });

    it('runs an allow-listed tool without asking', () => {
      connectors.set('mail', connector('needs_approval'));
      userIntervention.allowList = ['mail/send'];

      expect(getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('asks for an agent tool the client has not loaded, refuses anything else unknown', () => {
      expect(getAppToolCallPolicy('agent-app', 'send', { agentId: 'agt_1' })).toBe('confirm');
      expect(getAppToolCallPolicy('agent-app', 'send')).toBe('deny');
    });
  });

  describe('allow-list mode', () => {
    beforeEach(() => {
      userIntervention.approvalMode = 'allow-list';
    });

    it('asks before a tool that is not on the allow-list, even one set to run automatically', () => {
      connectors.set('mail', connector('auto'));
      plugins.set('weather', plugin());

      expect(getAppToolCallPolicy('mail', 'send')).toBe('confirm');
      expect(getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });

    it('runs a tool on the allow-list', () => {
      connectors.set('mail', connector('needs_approval'));
      userIntervention.allowList = ['mail/send'];

      expect(getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('still refuses a tool the server does not offer', () => {
      connectors.set('mail', connector('auto'));
      userIntervention.allowList = ['mail/delete'];

      expect(getAppToolCallPolicy('mail', 'delete')).toBe('deny');
    });
  });

  describe('auto-run mode', () => {
    beforeEach(() => {
      userIntervention.approvalMode = 'auto-run';
    });

    it('runs tools that would ask in manual mode', () => {
      connectors.set('mail', connector('needs_approval'));
      expect(getAppToolCallPolicy('mail', 'send')).toBe('allow');
    });

    it('still asks for a tool whose policy is always', () => {
      plugins.set('weather', plugin('always'));
      expect(getAppToolCallPolicy('weather', 'send')).toBe('confirm');
    });
  });

  it('asks for arguments the security blacklist matches, in every mode', () => {
    connectors.set('shell', {
      ...connector('auto'),
      tools: [{ permission: 'auto', toolName: 'run' }],
    });
    userIntervention.allowList = ['shell/run'];
    const toolArgs = { command: 'rm -rf ~/' };

    for (const mode of ['manual', 'allow-list', 'auto-run']) {
      userIntervention.approvalMode = mode;
      expect(getAppToolCallPolicy('shell', 'run', { toolArgs })).toBe('confirm');
    }
    expect(getAppToolCallPolicy('shell', 'run', { toolArgs: { command: 'ls' } })).toBe('allow');
  });
});

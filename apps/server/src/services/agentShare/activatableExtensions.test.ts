import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listShareActivatableExtensionIds } from './activatableExtensions';

const mocks = vi.hoisted(() => ({
  queryAvailableForAgent: vi.fn(),
  queryPlugins: vi.fn(),
}));

// Constructor mocks must be `function`s: `new` on an arrow-function mock throws.
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return { queryAvailableForAgent: mocks.queryAvailableForAgent };
  }),
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn(function () {
    return { query: mocks.queryPlugins };
  }),
}));

describe('listShareActivatableExtensionIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryAvailableForAgent.mockResolvedValue([
      { id: '1', identifier: 'mcp-connected', isEnabled: true, status: 'connected' },
      { id: '2', identifier: 'mcp-disconnected', isEnabled: true, status: 'error' },
      { id: '3', identifier: 'mcp-switched-off', isEnabled: false, status: 'connected' },
    ]);
    mocks.queryPlugins.mockResolvedValue([
      { identifier: 'plugin-installed' },
      { identifier: 'lobe-calculator' },
    ]);
  });

  it("lists the Agent's connected connectors, installed plugins and LobeHub connections", async () => {
    const ids = await listShareActivatableExtensionIds({
      agentId: 'agent-1',
      db: {} as any,
      listLobehubSkillProviderIds: async () => ['linear'],
      userId: 'owner',
    });

    expect(ids).toEqual(['mcp-connected', 'plugin-installed', 'linear']);
    expect(mocks.queryAvailableForAgent).toHaveBeenCalledWith('agent-1');
  });

  it('keeps the database extensions when the Market lookup fails', async () => {
    const ids = await listShareActivatableExtensionIds({
      agentId: 'agent-1',
      db: {} as any,
      listLobehubSkillProviderIds: async () => {
        throw new Error('market down');
      },
      userId: 'owner',
    });

    expect(ids).toEqual(['mcp-connected', 'plugin-installed']);
  });
});

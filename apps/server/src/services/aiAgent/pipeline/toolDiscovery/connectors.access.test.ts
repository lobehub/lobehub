import { beforeEach, describe, expect, it, vi } from 'vitest';

import { patchConnectorPermissions } from './connectors';

const storage = vi.hoisted(() => ({ tools: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: class {
    queryByConnector = storage.tools;
  },
}));
const manifest = (identifier: string) => ({
  identifier,
  api: [
    { name: 'read-page', parameters: {} },
    { name: 'write-page', parameters: {} },
  ],
});
const deps = (agentIds = ['toby']) => ({
  db: {},
  userId: 'user',
  connectorModel: {
    resolveByIdentifiers: async () => [
      {
        id: 'linear-connection',
        identifier: 'linear',
        isEnabled: true,
        status: 'connected',
        metadata: { nativeAccess: { agentIds, readToolNames: ['read-page'] } },
      },
    ],
  },
});
const targets = () =>
  ({
    composioManifests: [],
    lobehubSkillManifests: [manifest('linear')],
    pluginsWithoutConnectors: [{ identifier: 'linear', manifest: manifest('linear') }],
  }) as any;

beforeEach(() => {
  storage.tools.mockReset().mockResolvedValue([
    { toolName: 'read-page', permission: 'auto' },
    { toolName: 'write-page', permission: 'auto' },
  ]);
});

describe('native managed tools across Market and plugin discovery', () => {
  it('does not expose a managed service to an ungranted agent through another manifest source', async () => {
    const result = await patchConnectorPermissions(deps([]) as any, 'toby', targets());
    expect(result.lobehubSkillManifests).toEqual([]);
    expect(result.pluginsWithoutConnectors).toEqual([]);
  });

  it('keeps only the granted read API in both Market and plugin manifests', async () => {
    const result = await patchConnectorPermissions(deps() as any, 'toby', targets());
    expect(result.lobehubSkillManifests[0].api.map((api) => api.name)).toEqual(['read-page']);
    expect(
      (result.pluginsWithoutConnectors[0] as any).manifest.api.map((api: any) => api.name),
    ).toEqual(['read-page']);
  });

  it('does not advertise unverified external manifests when the scoped policy lookup fails', async () => {
    const context = deps();
    context.connectorModel.resolveByIdentifiers = async () => {
      throw new Error('database unavailable');
    };
    const result = await patchConnectorPermissions(context as any, 'toby', targets());
    expect(result.lobehubSkillManifests).toEqual([]);
    expect(result.pluginsWithoutConnectors).toEqual([]);
  });
});

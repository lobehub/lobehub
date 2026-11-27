// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveMcpDeviceFeatures } from '@/server/services/deviceGateway/deviceChannels';
import { getMcpParamsFingerprint } from '@/server/services/mcp/deviceView';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { ToolExecutionService } from '../index';

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return {
      resolveToolSets: async () => [
        {
          id: 'c',
          identifier: 'apps',
          isEnabled: true,
          mcpConnectionType: 'stdio',
          toolIdentifier: 'apps',
        },
      ],
    };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: vi.fn() }));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeMcpCall: vi.fn(), isConfigured: true },
}));
vi.mock('@/server/services/deviceGateway/deviceChannels', () => ({
  resolveMcpClientKinds: async () => ['cli'],
  resolveMcpDeviceFeatures: vi.fn(),
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: async () => undefined,
}));
vi.mock('../serverRuntimes/resolveWorkspaceScope', () => ({
  resolveRunWorkspaceId: async () => undefined,
}));

/** A stdio MCP Apps server, run on the user's device through `lh connect`. */
const stdio = {
  args: ['server.mjs'],
  command: 'node',
  env: { A: '1' },
  name: 'apps',
  type: 'stdio',
};
const payload = {
  apiName: 'show',
  arguments: '{}',
  id: 'call',
  identifier: 'apps',
  type: 'mcp',
} as any;
const run = (manifest: Record<string, unknown>) =>
  new ToolExecutionService({
    builtinToolsExecutor: {} as never,
    mcpService: { callTool: vi.fn() } as never,
  }).executeTool(payload, {
    activeDeviceId: 'nas',
    serverDB: {},
    toolManifestMap: { apps: manifest },
    userId: 'me',
  } as any);
const connectorManifest = { connector: { id: 'c', identifier: 'apps' }, mcpParams: stdio };
const sentParams = () => vi.mocked(deviceGateway.executeMcpCall).mock.calls[0][0].params;

describe('ToolExecutionService — MCP Apps views of a tunneled call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMcpAppsEnabled).mockResolvedValue(true);
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue(['apps']);
    vi.mocked(deviceGateway.executeMcpCall).mockResolvedValue({
      content: 'shown',
      state: {
        content: [{ text: 'shown', type: 'text' }],
        mcpApp: { resourceUri: 'ui://apps/view', server: 'fingerprint-of-what-the-device-spawned' },
      },
      success: true,
    });
  });

  it("keeps a connector's view, relayed through the device that ran it", async () => {
    const result = await run(connectorManifest);

    expect(sentParams()).toMatchObject({ mcpCall: { mcpApps: true } });
    expect(resolveMcpDeviceFeatures).toHaveBeenCalledWith('me', {
      clientKinds: ['cli'],
      deviceId: 'nas',
      workspaceId: undefined,
    });
    expect(result.content).toBe('shown');
    expect((result.state as any).mcpApp).toEqual({
      relayDeviceId: 'nas',
      resourceUri: 'ui://apps/view',
      server: await getMcpParamsFingerprint(stdio as any),
    });
  });

  it("gives a plain result from a device client that can't serve views", async () => {
    vi.mocked(resolveMcpDeviceFeatures).mockResolvedValue([]);

    const result = await run(connectorManifest);

    expect(sentParams()).not.toHaveProperty('mcpCall');
    expect(result.state).not.toHaveProperty('mcpApp');
  });

  it('gives a plain result while MCP Apps are off, without asking the device', async () => {
    vi.mocked(isMcpAppsEnabled).mockResolvedValue(false);

    const result = await run(connectorManifest);

    expect(resolveMcpDeviceFeatures).not.toHaveBeenCalled();
    expect(sentParams()).not.toHaveProperty('mcpCall');
    expect(result.state).not.toHaveProperty('mcpApp');
  });

  it("drops a plugin's view: no server route reads it back from the device", async () => {
    const result = await run({ mcpParams: stdio });

    expect(sentParams()).not.toHaveProperty('mcpCall');
    expect(result.state).not.toHaveProperty('mcpApp');
  });
});

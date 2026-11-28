import { getMcpServerFingerprint } from '@lobechat/const/mcpApp';
import { describe, expect, it } from 'vitest';

import { getMcpParamsFingerprint, relayDeviceViewState } from './deviceView';

const stdio = {
  args: ['server.mjs'],
  command: 'node',
  env: { TOKEN: 't' },
  name: 'apps',
  type: 'stdio' as const,
};

describe('getMcpParamsFingerprint', () => {
  it('names a stdio server by its command, arguments and environment', async () => {
    await expect(getMcpParamsFingerprint(stdio)).resolves.toBe(
      await getMcpServerFingerprint({
        args: ['server.mjs'],
        command: 'node',
        env: { TOKEN: 't' },
        type: 'stdio',
      }),
    );
  });

  it('names an HTTP server by its URL and headers, not its credentials', async () => {
    const http = {
      auth: { token: 'secret', type: 'bearer' as const },
      headers: { 'x-team': 'a' },
      name: 'nas',
      type: 'http' as const,
      url: 'http://192.168.1.2/mcp',
    };
    await expect(getMcpParamsFingerprint(http)).resolves.toBe(
      await getMcpServerFingerprint({
        headers: { 'x-team': 'a' },
        type: 'http',
        url: 'http://192.168.1.2/mcp',
      }),
    );
  });
});

describe('relayDeviceViewState', () => {
  const device = { deviceId: 'nas', workspaceId: 'ws-1' };
  // The device names the server by the params it spawned (with its own PATH), never ours
  const deviceState = {
    content: [{ text: 'ok', type: 'text' }],
    mcpApp: {
      preferredModelDisplayMode: 'fullscreen',
      resourceUri: 'ui://apps/view',
      server: 'device-side-fingerprint',
    },
  };

  it("keeps the view the device named, under the server's own fingerprint and the relay device", async () => {
    await expect(
      relayDeviceViewState(deviceState, { device, keep: true, params: stdio }),
    ).resolves.toEqual({
      content: deviceState.content,
      mcpApp: {
        preferredModelDisplayMode: 'fullscreen',
        relayDeviceId: 'nas',
        relayWorkspaceId: 'ws-1',
        resourceUri: 'ui://apps/view',
        server: await getMcpParamsFingerprint(stdio),
      },
    });
  });

  it('drops the view when it may not be kept: MCP Apps off, or a client that cannot serve it', async () => {
    await expect(
      relayDeviceViewState(deviceState, { device, keep: false, params: stdio }),
    ).resolves.toEqual({ content: deviceState.content });
  });

  it('drops a mark that names no ui:// resource, and an unknown display mode', async () => {
    await expect(
      relayDeviceViewState(
        { mcpApp: { resourceUri: 'https://evil.example/view' } },
        { device, keep: true, params: stdio },
      ),
    ).resolves.toEqual({});
    const kept = (await relayDeviceViewState(
      { mcpApp: { preferredModelDisplayMode: 'pip', resourceUri: 'ui://apps/view' } },
      { device: { deviceId: 'nas' }, keep: true, params: stdio },
    )) as any;
    expect(kept.mcpApp).not.toHaveProperty('preferredModelDisplayMode');
    expect(kept.mcpApp).not.toHaveProperty('relayWorkspaceId');
  });

  it('passes a missing state through', async () => {
    await expect(
      relayDeviceViewState(undefined, { device, keep: true, params: stdio }),
    ).resolves.toBeUndefined();
  });
});

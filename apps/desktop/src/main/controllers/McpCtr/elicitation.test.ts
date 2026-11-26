import { afterEach, expect, it, vi } from 'vitest';

import { relayNativeMcpResult } from './elicitation';

const config = {
  getRemoteServerUrl: async () => 'https://server.example',
  getAccessToken: async () => 'private-fixture-token',
  getDesktopBootstrapIdentity: () => ({ userId: 'owner', isIdentityResolved: true }),
};
const owner = { serverUrl: 'https://server.example', userId: 'owner' };
const call = {
  identity: {
    operationId: 'op',
    assistantMessageId: 'assistant',
    toolCallId: 'call_1',
    identifier: 'fixture',
    apiName: 'form',
  },
  deadline: Date.now() + 60000,
  relayResult: true,
};
afterEach(() => vi.unstubAllGlobals());

it.each(['origin-desktop', undefined])(
  'publishes native App provenance with device %s without changing the execution receipt',
  async (deviceId) => {
    const network = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', network);
    const result = {
      content: 'saved',
      success: true,
      state: {
        mcpApp: {
          resourceUri: 'ui://fixture/view',
          server: 'fingerprint',
          deviceId: 'untrusted-result-device',
        },
        content: [],
      },
    };
    await expect(
      relayNativeMcpResult(config, call, result, owner, async () => deviceId),
    ).resolves.toBe(true);
    const receipt = JSON.parse(network.mock.calls[0][1].body).json.result;
    expect(receipt.content).toBe('saved');
    expect(receipt.state.content).toEqual([]);
    expect(receipt.state.mcpApp).toEqual(
      deviceId ? { resourceUri: 'ui://fixture/view', server: 'fingerprint', deviceId } : undefined,
    );
    expect(result.state.mcpApp.deviceId).toBe('untrusted-result-device');
  },
);

it('does not resolve device identity for plain results or deliver a receipt after an account switch', async () => {
  const network = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', network);
  const device = vi.fn();
  const result = { content: 'saved', success: true, state: {} };
  await relayNativeMcpResult(config, call, result, owner, device);
  expect(device).not.toHaveBeenCalled();
  await expect(
    relayNativeMcpResult(config, call, result, { ...owner, userId: 'another-user' }, device),
  ).resolves.toBe(false);
  expect(network).toHaveBeenCalledOnce();
});

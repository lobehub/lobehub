import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayHttpClient } from './http';

describe('GatewayHttpClient clientKinds', () => {
  let client: GatewayHttpClient;

  beforeEach(() => {
    client = new GatewayHttpClient({
      gatewayUrl: 'https://gateway.test.com',
      serviceToken: 'test-service-token',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(response: Partial<Response>) {
    const res = {
      json: vi.fn().mockResolvedValue(response.json ? response.json() : {}),
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: vi.fn().mockResolvedValue(''),
      ...response,
    };
    // Re-bind json/text if the response object had them
    if ('json' in response && typeof response.json === 'function') {
      res.json = response.json;
    }
    if ('text' in response && typeof response.text === 'function') {
      res.text = response.text;
    }
    vi.mocked(fetch).mockResolvedValue(res as any);
    return res;
  }

  describe('clientKinds', () => {
    const bodyOf = (call = 0) =>
      JSON.parse(vi.mocked(fetch).mock.calls[call][1]!.body as string) as Record<string, unknown>;

    const withResolver = () => {
      const resolveClientKinds = vi.fn((target: { kind: string; method?: string }) =>
        target.kind === 'rpc' && target.method === 'listSkills' ? [] : (['desktop'] as const),
      );
      const kindsClient = new GatewayHttpClient({
        gatewayUrl: 'https://gateway.test.com',
        resolveClientKinds: resolveClientKinds as never,
        serviceToken: 'test-token',
      });
      return { kindsClient, resolveClientKinds };
    };

    it('sends the resolved clientKinds with a tool call, tagged by identifier and type', async () => {
      const { kindsClient, resolveClientKinds } = withResolver();
      mockFetch({ json: vi.fn().mockResolvedValue({ content: 'ok', success: true }), ok: true });

      await kindsClient.executeToolCall(
        { deviceId: 'device-1', userId: 'user-1' },
        { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-computer-use' },
      );

      expect(resolveClientKinds).toHaveBeenCalledWith({
        identifier: 'lobe-computer-use',
        kind: 'tool',
        type: 'tool',
      });
      expect(bodyOf()).toMatchObject({ clientKinds: ['desktop'] });
    });

    it('resolves MCP calls, the message API and RPC by their own target', async () => {
      const { kindsClient, resolveClientKinds } = withResolver();
      mockFetch({ json: vi.fn().mockResolvedValue({ success: true }), ok: true });

      await kindsClient.executeMcpCall({
        apiName: 'search',
        arguments: '{}',
        identifier: 'mcp-server',
        params: {} as never,
        userId: 'user-1',
      });
      await kindsClient.executeMessageApi(
        { userId: 'user-1' },
        { apiName: 'sendMessage', payload: {}, platform: 'imessage' },
      );
      await kindsClient.invokeRpc({ userId: 'user-1' }, { method: 'trashLocalFiles' });

      expect(resolveClientKinds.mock.calls.map(([target]) => target)).toEqual([
        { identifier: 'mcp-server', kind: 'tool', type: 'mcp' },
        { kind: 'messageApi', platform: 'imessage' },
        { kind: 'rpc', method: 'trashLocalFiles' },
      ]);
      for (const call of [0, 1, 2]) expect(bodyOf(call).clientKinds).toEqual(['desktop']);
    });

    it('sends clientKinds given by the caller instead of resolving them from the tool', async () => {
      const { kindsClient, resolveClientKinds } = withResolver();
      mockFetch({ json: vi.fn().mockResolvedValue({ content: 'ok', success: true }), ok: true });

      await kindsClient.executeToolCall(
        { clientKinds: ['cli'], deviceId: 'device-1', userId: 'user-1' },
        { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-computer-use' },
      );

      expect(bodyOf()).toMatchObject({ clientKinds: ['cli'] });
      expect(resolveClientKinds).not.toHaveBeenCalled();
    });

    it('omits clientKinds when any client can serve the request', async () => {
      const { kindsClient } = withResolver();
      mockFetch({ json: vi.fn().mockResolvedValue({ success: true }), ok: true });

      await kindsClient.invokeRpc({ userId: 'user-1' }, { method: 'listSkills' });
      await client.invokeRpc({ userId: 'user-1' }, { method: 'trashLocalFiles' });

      expect(bodyOf(0)).not.toHaveProperty('clientKinds');
      expect(bodyOf(1)).not.toHaveProperty('clientKinds');
    });

    it('passes clientKinds given for a system-info read', async () => {
      mockFetch({ json: vi.fn().mockResolvedValue({ success: true, systemInfo: {} }), ok: true });

      await client.getDeviceSystemInfo('user-1', 'device-1', undefined, {
        clientKinds: ['desktop'],
      });

      expect(bodyOf()).toMatchObject({ clientKinds: ['desktop'], deviceId: 'device-1' });
    });
  });
});

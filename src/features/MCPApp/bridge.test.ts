import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildHostContext, connectMcpAppBridge, type McpAppBridgeHost } from './bridge';

const setup = (overrides: Partial<McpAppBridgeHost> = {}) => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const target = iframe.contentWindow!;
  const posted = vi.spyOn(target, 'postMessage');

  const host: McpAppBridgeHost = {
    callTool: vi.fn().mockResolvedValue({ content: [{ text: 'rainy', type: 'text' }] }),
    hostContext: buildHostContext(false),
    onSizeChange: vi.fn(),
    openLink: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn(),
    toolInput: () => ({ city: 'Paris' }),
    toolResult: () => ({ content: [{ text: 'sunny', type: 'text' }] }),
    ...overrides,
  };
  const connection = connectMcpAppBridge(target, host);

  /** Deliver a JSON-RPC message as if the view posted it. */
  const fromView = async (data: Record<string, unknown>) => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', ...data }, source: target }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const sent = () => posted.mock.calls.map(([message]) => message as any);
  const response = (id: number) => sent().find((message) => message.id === id);

  return { connection, fromView, host, response, sent };
};

describe('connectMcpAppBridge', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('leaves ui/open-link to the host, which may decline it', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { fromView, host, response } = setup();

    await fromView({ id: 1, method: 'ui/open-link', params: { url: 'https://example.com/?q=1' } });
    expect(host.openLink).toHaveBeenCalledWith('https://example.com/?q=1', expect.any(AbortSignal));
    expect(response(1)?.result.isError).toBeUndefined();

    vi.mocked(host.openLink).mockResolvedValueOnce(false);
    await fromView({ id: 2, method: 'ui/open-link', params: { url: 'https://example.com/' } });
    expect(response(2)?.result.isError).toBe(true);

    // Only web links reach the host
    await fromView({ id: 3, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } });
    expect(host.openLink).toHaveBeenCalledTimes(2);
    expect(response(3)?.result.isError).toBe(true);
    // The bridge never opens anything itself
    expect(open).not.toHaveBeenCalled();
  });

  it('answers ui/initialize, then sends the tool input and result', async () => {
    const { fromView, response, sent } = setup();

    await fromView({
      id: 1,
      method: 'ui/initialize',
      params: {
        appCapabilities: {},
        appInfo: { name: 'weather', version: '1.0.0' },
        protocolVersion: '2026-01-26',
      },
    });
    expect(response(1)?.result.hostInfo.name).toBe('LobeHub');
    expect(response(1)?.result.hostContext.theme).toBe('light');

    await fromView({ method: 'ui/notifications/initialized' });

    const input = sent().find((m) => m.method === 'ui/notifications/tool-input');
    const result = sent().find((m) => m.method === 'ui/notifications/tool-result');
    expect(input.params).toEqual({ arguments: { city: 'Paris' } });
    expect(result.params).toEqual({ content: [{ text: 'sunny', type: 'text' }] });
  });

  it('routes tool calls and user messages to the host', async () => {
    const { fromView, host, response } = setup();
    await fromView({ method: 'ui/notifications/initialized' });

    await fromView({
      id: 2,
      method: 'tools/call',
      params: { arguments: { city: 'Rome' }, name: 'get_forecast' },
    });
    expect(host.callTool).toHaveBeenCalledWith(
      'get_forecast',
      { city: 'Rome' },
      expect.any(AbortSignal),
    );
    expect(response(2)?.result).toEqual({ content: [{ text: 'rainy', type: 'text' }] });

    await fromView({
      id: 3,
      method: 'ui/message',
      params: { content: [{ text: 'Plan a trip to Rome', type: 'text' }], role: 'user' },
    });
    expect(host.sendMessage).toHaveBeenCalledWith('Plan a trip to Rome', expect.any(AbortSignal));
    expect(response(3)?.result).toEqual({});
  });

  it('aborts a request signal once the view cancels that request', async () => {
    const { fromView, host } = setup({ callTool: vi.fn(() => new Promise<never>(() => {})) });
    await fromView({ method: 'ui/notifications/initialized' });

    await fromView({
      id: 7,
      method: 'tools/call',
      params: { arguments: {}, name: 'get_forecast' },
    });
    const signal = vi.mocked(host.callTool).mock.calls[0][2];
    expect(signal.aborted).toBe(false);

    // What the view sends when its request times out
    await fromView({
      method: 'notifications/cancelled',
      params: { reason: 'timeout', requestId: 7 },
    });
    expect(signal.aborted).toBe(true);
  });

  it('answers a message the host declined with an error', async () => {
    const { fromView, response } = setup({ sendMessage: vi.fn().mockResolvedValue(false) });
    await fromView({ method: 'ui/notifications/initialized' });

    await fromView({
      id: 6,
      method: 'ui/message',
      params: { content: [{ text: 'Plan a trip to Rome', type: 'text' }], role: 'user' },
    });
    expect(response(6)?.result).toEqual({ isError: true });
  });

  it('reports size changes and ignores messages from other windows', async () => {
    const { connection, fromView, host } = setup();

    await fromView({ method: 'ui/notifications/size-changed', params: { height: 480.2 } });
    expect(host.onSizeChange).toHaveBeenCalledWith(481);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 9 } },
        source: window,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.onSizeChange).toHaveBeenCalledTimes(1);

    connection.dispose();
    await fromView({ method: 'ui/notifications/size-changed', params: { height: 100 } });
    expect(host.onSizeChange).toHaveBeenCalledTimes(1);
  });
  it('tells an initialized view it is going away and waits for its answer before closing', async () => {
    const { connection, fromView, sent } = setup();
    await fromView({ method: 'ui/notifications/initialized' });
    const close = vi.spyOn(connection.bridge, 'close');

    let done = false;
    const teardown = connection.teardown(3000).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = sent().find((m) => m.method === 'ui/resource-teardown');
    expect(request).toBeDefined();
    expect(done).toBe(false);
    expect(close).not.toHaveBeenCalled();

    // The view saved its edits and answers
    await fromView({ id: request.id, result: {} });
    await teardown;
    expect(close).toHaveBeenCalled();
  });

  it('closes a view that never answers once the wait is over, and one never initialized at once', async () => {
    vi.useFakeTimers();
    try {
      const silent = setup();
      silent.fromView({ method: 'ui/notifications/initialized' });
      await vi.advanceTimersByTimeAsync(0);
      const closeSilent = vi.spyOn(silent.connection.bridge, 'close');
      const teardown = silent.connection.teardown(3000);
      await vi.advanceTimersByTimeAsync(3000);
      await teardown;
      expect(closeSilent).toHaveBeenCalled();

      const fresh = setup();
      const closeFresh = vi.spyOn(fresh.connection.bridge, 'close');
      await fresh.connection.teardown(3000);
      expect(fresh.sent().some((m) => m.method === 'ui/resource-teardown')).toBe(false);
      expect(closeFresh).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

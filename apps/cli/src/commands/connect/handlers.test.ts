import type { GatewayClient, ToolCallRequestMessage } from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeDeviceMcpCall } from '../../device/mcp';
import { executeToolCall } from '../../tools';
import { bindGatewayClientHandlers, type GatewayHandlerContext } from './handlers';

vi.mock('../../tools', () => ({
  executeToolCall: vi.fn().mockResolvedValue({ content: 'local tool ran', success: true }),
}));

vi.mock('../../daemon/manager', () => ({ appendLog: vi.fn() }));

vi.mock('../../device/mcp', () => ({
  executeDeviceMcpCall: vi.fn().mockResolvedValue({ content: 'mcp tool ran', success: true }),
}));

const createClient = () => {
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
  const client = {
    on: vi.fn((event: string, handler: (...args: any[]) => Promise<void>) => {
      handlers[event] = handler;
    }),
    sendToolCallResponse: vi.fn(),
  };
  return { client, handlers };
};

const createContext = (): GatewayHandlerContext =>
  ({
    deps: {},
    error: vi.fn(),
    getAuth: () => ({ serverUrl: 'https://app.test', token: 'token' }),
    getToolAuth: () => ({ serverUrl: 'https://app.test', token: 'token' }),
    info: vi.fn(),
    isDaemonChild: true,
    maintenance: { afterResponse: vi.fn(), run: (fn: () => unknown) => fn() },
    nativeRuntimes: { get: vi.fn().mockResolvedValue([]) },
    recordRequest: vi.fn(),
  }) as unknown as GatewayHandlerContext;

const toolCallRequest = (
  toolCall: Partial<ToolCallRequestMessage['toolCall']>,
): ToolCallRequestMessage => ({
  requestId: 'req-1',
  toolCall: { apiName: 'runCommand', arguments: '{"command":"id"}', identifier: 'x', ...toolCall },
  type: 'tool_call_request',
});

describe('bindGatewayClientHandlers tool_call_request routing', () => {
  let client: ReturnType<typeof createClient>['client'];
  let handlers: ReturnType<typeof createClient>['handlers'];

  beforeEach(() => {
    vi.mocked(executeToolCall).mockClear();
    vi.mocked(executeDeviceMcpCall).mockClear();
    ({ client, handlers } = createClient());
    bindGatewayClientHandlers(client as unknown as GatewayClient, createContext());
  });

  it('runs a plain tool call, and one from an older server without a type, locally', async () => {
    await handlers.tool_call_request(toolCallRequest({ type: 'tool' }));
    await handlers.tool_call_request(toolCallRequest({}));

    expect(executeToolCall).toHaveBeenCalledTimes(2);
  });

  it('runs a tunneled MCP call on the MCP runtime, not the same-named local tool', async () => {
    const params = {
      args: ['--stdio'],
      command: 'mcp-server',
      name: 'some-mcp-server',
      type: 'stdio' as const,
    };
    await handlers.tool_call_request({
      ...toolCallRequest({ identifier: 'some-mcp-server', params, type: 'mcp' }),
      timeout: 30_000,
    });

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(executeDeviceMcpCall).toHaveBeenCalledWith(
      { apiName: 'runCommand', arguments: '{"command":"id"}', params, timeout: 30_000 },
      expect.any(Function),
    );
    expect(client.sendToolCallResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: expect.objectContaining({ content: 'mcp tool ran', success: true }),
    });
  });

  it('fails an MCP call that carries no connection params', async () => {
    await handlers.tool_call_request(toolCallRequest({ type: 'mcp' }));

    expect(executeDeviceMcpCall).not.toHaveBeenCalled();
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(client.sendToolCallResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: expect.objectContaining({ success: false }),
    });
  });

  it('never runs a same-named local tool for a call kind it does not support', async () => {
    await handlers.tool_call_request(
      toolCallRequest({
        identifier: 'some-mcp-server',
        params: { args: [], command: 'mcp-server', name: 'some-mcp-server', type: 'stdio' },
        type: 'skill' as any,
      }),
    );

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(client.sendToolCallResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: expect.objectContaining({
        error: expect.stringContaining('does not support "skill" tool calls'),
        success: false,
      }),
    });
  });
});

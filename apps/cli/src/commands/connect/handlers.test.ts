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

describe('bindGatewayClientHandlers tool_call_request completion', () => {
  const stillRunning = {
    content: 'Command is still running after the wait window.\nshell_id: sh-1',
    state: { commandId: 'sh-1', isBackground: false, running: true, success: true },
    success: true,
  };
  const finished = {
    content: 'Exit code: 0\nASYNC_DONE',
    state: { exitCode: 0, running: false, stdout: 'ASYNC_DONE', success: true },
    success: true,
  };
  const runCommand = (completion?: { toolCallId: string }): ToolCallRequestMessage => ({
    completion,
    operationId: 'op-1',
    requestId: 'req-1',
    toolCall: {
      apiName: 'runCommand',
      arguments: '{"command":"sleep 120"}',
      identifier: 'lobe-local-system',
    },
    type: 'tool_call_request',
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  let client: ReturnType<typeof createClient>['client'] & {
    off: ReturnType<typeof vi.fn>;
    reportToolCallCompletion: ReturnType<typeof vi.fn>;
  };
  let handlers: ReturnType<typeof createClient>['handlers'];

  beforeEach(() => {
    vi.mocked(executeToolCall).mockReset();
    const created = createClient();
    handlers = created.handlers;
    client = Object.assign(created.client, {
      off: vi.fn(),
      reportToolCallCompletion: vi
        .fn()
        .mockResolvedValue({ operationId: 'op-1', status: 'delivered', toolCallId: 'call-1' }),
    });
    bindGatewayClientHandlers(client as unknown as GatewayClient, createContext());
  });

  it('keeps watching a still-running command and reports its final output', async () => {
    vi.mocked(executeToolCall).mockResolvedValueOnce(stillRunning).mockResolvedValueOnce(finished);

    await handlers.tool_call_request(runCommand({ toolCallId: 'call-1' }));
    await flush();

    expect(client.sendToolCallResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: expect.objectContaining({
        state: expect.objectContaining({ commandId: 'sh-1', completionWatch: true }),
      }),
    });
    expect(executeToolCall).toHaveBeenLastCalledWith(
      'getCommandOutput',
      JSON.stringify({ shell_id: 'sh-1', timeout: 600_000 }),
      600_000,
      expect.anything(),
    );
    expect(client.reportToolCallCompletion).toHaveBeenCalledWith({
      operationId: 'op-1',
      result: { content: finished.content, state: finished.state, success: true },
      toolCallId: 'call-1',
    });
  });

  it('answers as before when the server did not ask for a late result', async () => {
    vi.mocked(executeToolCall).mockResolvedValueOnce(stillRunning);

    await handlers.tool_call_request(runCommand());
    await flush();

    expect(client.sendToolCallResponse.mock.calls[0][0].result.state).not.toHaveProperty(
      'completionWatch',
    );
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(client.reportToolCallCompletion).not.toHaveBeenCalled();
  });

  it('does not watch a command that already finished', async () => {
    vi.mocked(executeToolCall).mockResolvedValueOnce(finished);

    await handlers.tool_call_request(runCommand({ toolCallId: 'call-1' }));
    await flush();

    expect(client.sendToolCallResponse.mock.calls[0][0].result.state).not.toHaveProperty(
      'completionWatch',
    );
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(client.reportToolCallCompletion).not.toHaveBeenCalled();
  });
});

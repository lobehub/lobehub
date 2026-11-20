import { EventEmitter } from 'node:events';

import type { ToolCallRequestMessage } from '@lobechat/device-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { isStarted: vi.fn(() => false), start: vi.fn(() => 1), stop: vi.fn() },
}));

vi.mock('@lobechat/local-file-shell/shell', () => ({
  executeDeviceOperation: (_meta: unknown, run: () => Promise<unknown>) => run(),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createClient = () =>
  Object.assign(new EventEmitter(), {
    reportToolCallCompletion: vi.fn().mockResolvedValue({
      operationId: 'op-1',
      status: 'delivered',
      toolCallId: 'call-1',
    }),
    sendToolCallResponse: vi.fn(),
  });

const runCommandRequest = (
  overrides: Partial<ToolCallRequestMessage> = {},
): ToolCallRequestMessage => ({
  operationId: 'op-1',
  requestId: 'req-1',
  toolCall: {
    apiName: 'runCommand',
    arguments: JSON.stringify({ command: 'sleep 120' }),
    identifier: 'lobe-local-system',
  },
  type: 'tool_call_request',
  ...overrides,
});

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GatewayConnectionService tool call completion', () => {
  let service: GatewayConnectionService;
  let client: ReturnType<typeof createClient>;
  let toolCallHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new GatewayConnectionService({} as App);
    client = createClient();
    (service as any).client = client;
    toolCallHandler = vi.fn();
    service.setToolCallHandler(toolCallHandler as any);
  });

  it('keeps watching a still-running command and reports its final output', async () => {
    toolCallHandler.mockResolvedValueOnce(stillRunning).mockResolvedValueOnce(finished);

    await (service as any).handleToolCallRequest(
      runCommandRequest({ completion: { toolCallId: 'call-1' } }),
      client,
    );
    await flush();

    expect(client.sendToolCallResponse).toHaveBeenCalledWith({
      requestId: 'req-1',
      result: expect.objectContaining({
        state: expect.objectContaining({ commandId: 'sh-1', completionWatch: true }),
      }),
    });
    expect(toolCallHandler).toHaveBeenLastCalledWith('lobe-local-system', 'getCommandOutput', {
      shell_id: 'sh-1',
      timeout: 600_000,
    });
    expect(client.reportToolCallCompletion).toHaveBeenCalledWith({
      operationId: 'op-1',
      result: { content: finished.content, state: finished.state, success: true },
      toolCallId: 'call-1',
    });
  });

  it('answers as before when the server did not ask for a late result', async () => {
    toolCallHandler.mockResolvedValueOnce(stillRunning);

    await (service as any).handleToolCallRequest(runCommandRequest(), client);
    await flush();

    const reply = client.sendToolCallResponse.mock.calls[0][0];
    expect(reply.result.state).not.toHaveProperty('completionWatch');
    expect(toolCallHandler).toHaveBeenCalledTimes(1);
    expect(client.reportToolCallCompletion).not.toHaveBeenCalled();
  });

  it('does not watch a command that already finished', async () => {
    toolCallHandler.mockResolvedValueOnce(finished);

    await (service as any).handleToolCallRequest(
      runCommandRequest({ completion: { toolCallId: 'call-1' } }),
      client,
    );
    await flush();

    const reply = client.sendToolCallResponse.mock.calls[0][0];
    expect(reply.result.state).not.toHaveProperty('completionWatch');
    expect(toolCallHandler).toHaveBeenCalledTimes(1);
    expect(client.reportToolCallCompletion).not.toHaveBeenCalled();
  });

  it('reports through the workspace connection the call arrived on', async () => {
    const workspaceClient = createClient();
    (service as any).workspaceClients.set('ws-1', workspaceClient);
    toolCallHandler.mockResolvedValueOnce(stillRunning).mockResolvedValueOnce(finished);

    await (service as any).handleToolCallRequest(
      runCommandRequest({ completion: { toolCallId: 'call-1' } }),
      workspaceClient,
    );
    await flush();

    expect(workspaceClient.reportToolCallCompletion).toHaveBeenCalledTimes(1);
    expect(client.reportToolCallCompletion).not.toHaveBeenCalled();
  });
});

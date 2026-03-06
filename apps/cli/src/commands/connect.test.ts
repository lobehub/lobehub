import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/resolveToken', () => ({
  resolveToken: vi.fn().mockResolvedValue({ token: 'test-token', userId: 'test-user' }),
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    toolCall: vi.fn(),
    toolResult: vi.fn(),
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

vi.mock('../tools/shell', () => ({
  cleanupAllProcesses: vi.fn(),
}));

vi.mock('../tools', () => ({
  executeToolCall: vi.fn().mockResolvedValue({
    content: 'tool result',
    success: true,
  }),
}));

let clientEventHandlers: Record<string, (...args: any[]) => any> = {};
let connectCalled = false;
let lastSentToolResponse: any = null;
let lastSentSystemInfoResponse: any = null;
vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: vi.fn().mockImplementation(() => {
    clientEventHandlers = {};
    connectCalled = false;
    lastSentToolResponse = null;
    lastSentSystemInfoResponse = null;
    return {
      connect: vi.fn().mockImplementation(async () => {
        connectCalled = true;
      }),
      currentDeviceId: 'mock-device-id',
      disconnect: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        clientEventHandlers[event] = handler;
      }),
      sendSystemInfoResponse: vi.fn().mockImplementation((data: any) => {
        lastSentSystemInfoResponse = data;
      }),
      sendToolCallResponse: vi.fn().mockImplementation((data: any) => {
        lastSentToolResponse = data;
      }),
    };
  }),
}));

// eslint-disable-next-line import-x/first
import { resolveToken } from '../auth/resolveToken';
// eslint-disable-next-line import-x/first
import { executeToolCall } from '../tools';
// eslint-disable-next-line import-x/first
import { cleanupAllProcesses } from '../tools/shell';
// eslint-disable-next-line import-x/first
import { log, setVerbose } from '../utils/logger';
// eslint-disable-next-line import-x/first
import { registerConnectCommand } from './connect';

describe('connect command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerConnectCommand(program);
    return program;
  }

  it('should connect to gateway', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(connectCalled).toBe(true);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('LobeHub CLI'));
  });

  it('should handle tool call requests', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // Trigger tool call
    await clientEventHandlers['tool_call_request']?.({
      requestId: 'req-1',
      toolCall: { apiName: 'readLocalFile', arguments: '{"path":"/test"}', identifier: 'test' },
      type: 'tool_call_request',
    });

    expect(executeToolCall).toHaveBeenCalledWith('readLocalFile', '{"path":"/test"}');
    expect(lastSentToolResponse).toEqual({
      requestId: 'req-1',
      result: { content: 'tool result', error: undefined, success: true },
    });
  });

  it('should handle system info requests', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['system_info_request']?.({
      requestId: 'req-2',
      type: 'system_info_request',
    });

    expect(lastSentSystemInfoResponse).toBeDefined();
    expect(lastSentSystemInfoResponse.requestId).toBe('req-2');
    expect(lastSentSystemInfoResponse.result.success).toBe(true);
    expect(lastSentSystemInfoResponse.result.systemInfo).toHaveProperty('homePath');
    expect(lastSentSystemInfoResponse.result.systemInfo).toHaveProperty('arch');
  });

  it('should handle auth_failed', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['auth_failed']?.('invalid token');

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authentication failed'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle auth_expired', async () => {
    vi.mocked(resolveToken).mockResolvedValueOnce({ token: 'new-tok', userId: 'user' });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    await clientEventHandlers['auth_expired']?.();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle error event', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['error']?.(new Error('connection lost'));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('should set verbose mode when -v flag is passed', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect', '-v']);

    expect(setVerbose).toHaveBeenCalledWith(true);
  });

  it('should show service-token auth type', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'connect',
      '--service-token',
      'svc-tok',
      '--user-id',
      'u1',
    ]);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('service-token'));
  });

  it('should handle SIGINT', async () => {
    const sigintHandlers: Array<() => void> = [];
    const origOn = process.on;
    vi.spyOn(process, 'on').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGINT') sigintHandlers.push(handler);
      return origOn.call(process, event, handler);
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // Trigger SIGINT handler
    for (const handler of sigintHandlers) {
      handler();
    }

    expect(cleanupAllProcesses).toHaveBeenCalled();
  });

  it('should handle auth_expired when refresh fails', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    // After initial connect, mock resolveToken to return falsy for the refresh attempt
    vi.mocked(resolveToken).mockResolvedValueOnce(undefined as any);

    await clientEventHandlers['auth_expired']?.();

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not refresh'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
  });

  it('should handle SIGTERM', async () => {
    const sigtermHandlers: Array<() => void> = [];
    const origOn = process.on;
    vi.spyOn(process, 'on').mockImplementation((event: any, handler: any) => {
      if (event === 'SIGTERM') sigtermHandlers.push(handler);
      return origOn.call(process, event, handler);
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    for (const handler of sigtermHandlers) {
      handler();
    }

    expect(cleanupAllProcesses).toHaveBeenCalled();
  });

  it('should generate correct system info with Movies for non-linux', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    clientEventHandlers['system_info_request']?.({
      requestId: 'req-3',
      type: 'system_info_request',
    });

    const sysInfo = lastSentSystemInfoResponse.result.systemInfo;
    // On macOS (darwin), video dir should be Movies
    if (process.platform !== 'linux') {
      expect(sysInfo.videosPath).toContain('Movies');
    } else {
      expect(sysInfo.videosPath).toContain('Videos');
    }
  });
});

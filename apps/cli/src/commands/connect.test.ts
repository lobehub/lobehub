import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/resolveToken', () => ({
  resolveToken: vi.fn().mockResolvedValue({
    serverUrl: 'https://app.lobehub.com',
    token: 'test-token',
    tokenType: 'jwt',
    userId: 'test-user',
  }),
}));
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue(null),
  normalizeUrl: vi.fn((url?: string) => (url ? url.replace(/\/$/, '') : undefined)),
  saveSettings: vi.fn(),
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

let mockRunningPid: number | null = null;
let mockSpawnedPid = 0;
let mockStatus: any = null;
vi.mock('../daemon/manager', () => ({
  appendLog: vi.fn(),
  getLogPath: vi.fn().mockReturnValue('/tmp/test-daemon.log'),
  getRunningDaemonPid: vi.fn().mockImplementation(() => mockRunningPid),
  readStatus: vi.fn().mockImplementation(() => mockStatus),
  removePid: vi.fn(),
  removeStatus: vi.fn(),
  spawnDaemon: vi.fn().mockImplementation(() => {
    mockSpawnedPid = 99999;
    return mockSpawnedPid;
  }),
  stopDaemon: vi.fn().mockImplementation(() => {
    if (mockRunningPid !== null) {
      mockRunningPid = null;
      return true;
    }
    return false;
  }),
  writeStatus: vi.fn(),
}));

vi.mock('../tools', () => ({
  executeToolCall: vi.fn().mockResolvedValue({
    content: 'tool result',
    success: true,
  }),
}));

let clientEventHandlers: Record<string, (...args: any[]) => any> = {};
let clientOptions: any = {};
let connectCalled = false;
let lastSentToolResponse: any = null;
let lastSentSystemInfoResponse: any = null;
vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: vi.fn().mockImplementation((opts: any) => {
    clientOptions = opts;
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
import { removeStatus, spawnDaemon, stopDaemon, writeStatus } from '../daemon/manager';
// eslint-disable-next-line import-x/first
import { loadSettings, saveSettings } from '../settings';
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
    mockRunningPid = null;
    mockSpawnedPid = 0;
    mockStatus = null;
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

  it('should persist deviceId in status for foreground connections', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(writeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'connecting', deviceId: 'mock-device-id' }),
    );

    clientEventHandlers.connected?.();

    expect(writeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionStatus: 'connected', deviceId: 'mock-device-id' }),
    );
  });

  it('should persist deviceId in status for daemon child connections', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect', '--daemon-child']);

    expect(writeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connectionStatus: 'connecting', deviceId: 'mock-device-id' }),
    );

    clientEventHandlers.connected?.();

    expect(writeStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectionStatus: 'connected', deviceId: 'mock-device-id' }),
    );
  });

  it('should connect to gateway', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(connectCalled).toBe(true);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('LobeHub CLI'));
  });

  it('should require explicit gateway for custom login server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({ serverUrl: 'https://self-hosted.example.com' });

    const program = createProgram();
    await expect(program.parseAsync(['node', 'test', 'connect'])).rejects.toThrow('process.exit');
    expect(log.error).toHaveBeenCalledWith(
      "Current login uses custom --server https://self-hosted.example.com. Please also provide '--gateway <url>' for the device gateway.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should use explicit gateway for custom login server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({ serverUrl: 'https://self-hosted.example.com' });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'connect',
      '--gateway',
      'https://gateway.example.com/',
    ]);

    expect(clientOptions.gatewayUrl).toBe('https://gateway.example.com');
    expect(saveSettings).toHaveBeenCalledWith({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://self-hosted.example.com',
    });
  });
  it('should pass the resolved serverUrl to GatewayClient', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    expect(clientOptions.serverUrl).toBe('https://app.lobehub.com');
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
    vi.mocked(resolveToken).mockResolvedValueOnce({
      serverUrl: 'https://app.lobehub.com',
      token: 'new-tok',
      tokenType: 'jwt',
      userId: 'user',
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    await clientEventHandlers['auth_expired']?.();

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(cleanupAllProcesses).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should ignore auth_expired for api key auth', async () => {
    vi.mocked(resolveToken).mockResolvedValueOnce({
      serverUrl: 'https://self-hosted.example.com',
      token: 'test-api-key',
      tokenType: 'apiKey',
      userId: 'user',
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'connect']);

    await clientEventHandlers['auth_expired']?.();

    expect(log.error).not.toHaveBeenCalled();
    expect(cleanupAllProcesses).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
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
    expect(removeStatus).toHaveBeenCalled();
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

  describe('--daemon flag', () => {
    it('should spawn daemon and exit', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', '--daemon']);

      expect(spawnDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon started'));
    });

    it('should refuse if daemon already running', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', '--daemon']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('already running'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('connect stop', () => {
    it('should stop running daemon', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'stop']);

      expect(stopDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
    });

    it('should warn if no daemon is running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'stop']);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No daemon'));
    });
  });

  describe('connect status', () => {
    it('should show no daemon running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'status']);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('No daemon'));
    });

    it('should show daemon status', async () => {
      mockRunningPid = 12345;
      mockStatus = {
        connectionStatus: 'connected',
        gatewayUrl: 'https://gateway.test.com',
        pid: 12345,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
      };

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'status']);

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon Status'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('12345'));
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('connected'));
    });
  });

  describe('connect restart', () => {
    it('should stop and start daemon', async () => {
      mockRunningPid = 12345;

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'restart']);

      expect(stopDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Stopped existing'));
      expect(spawnDaemon).toHaveBeenCalled();
    });

    it('should start daemon even if none was running', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'connect', 'restart']);

      expect(spawnDaemon).toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Daemon started'));
    });
  });
});

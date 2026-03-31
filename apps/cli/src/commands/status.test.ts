import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock resolveToken
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
    warn: vi.fn(),
  },
  setVerbose: vi.fn(),
}));

// Track event handlers registered on GatewayClient instances
let clientEventHandlers: Record<string, (...args: any[]) => any> = {};
let connectCalled = false;
let clientOptions: any = {};

vi.mock('@lobechat/device-gateway-client', () => ({
  GatewayClient: vi.fn().mockImplementation((opts: any) => {
    clientOptions = opts;
    clientEventHandlers = {};
    connectCalled = false;
    return {
      connect: vi.fn().mockImplementation(async () => {
        connectCalled = true;
      }),
      disconnect: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        clientEventHandlers[event] = handler;
      }),
    };
  }),
}));

// eslint-disable-next-line import-x/first
import { loadSettings, saveSettings } from '../settings';
// eslint-disable-next-line import-x/first
import { log } from '../utils/logger';
// eslint-disable-next-line import-x/first
import { registerStatusCommand } from './status';

describe('status command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerStatusCommand(program);
    return program;
  }

  it('should create client with autoReconnect false', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    // Trigger connected to finish the command
    clientEventHandlers['connected']?.();

    await parsePromise;
    expect(clientOptions.autoReconnect).toBe(false);
  });

  it('should require explicit gateway for custom login server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({ serverUrl: 'https://self-hosted.example.com' });

    const program = createProgram();
    await expect(program.parseAsync(['node', 'test', 'status'])).rejects.toThrow('process.exit');
    expect(log.error).toHaveBeenCalledWith(
      "Current login uses custom --server https://self-hosted.example.com. Please also provide '--gateway <url>' for the device gateway.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should use explicit gateway for custom login server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({ serverUrl: 'https://self-hosted.example.com' });

    const program = createProgram();
    const parsePromise = program.parseAsync([
      'node',
      'test',
      'status',
      '--gateway',
      'https://gateway.example.com/',
    ]);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['connected']?.();

    await parsePromise;
    expect(clientOptions.gatewayUrl).toBe('https://gateway.example.com');
    expect(saveSettings).toHaveBeenCalledWith({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://self-hosted.example.com',
    });
  });
  it('should pass the resolved serverUrl to GatewayClient', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['connected']?.();

    await parsePromise;
    expect(clientOptions.serverUrl).toBe('https://app.lobehub.com');
  });

  it('should log CONNECTED on successful connection', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['connected']?.();

    await parsePromise;
    expect(log.info).toHaveBeenCalledWith('CONNECTED');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should log FAILED on disconnected', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['disconnected']?.();

    await parsePromise;
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should log FAILED on auth_failed', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['auth_failed']?.('bad token');

    await parsePromise;
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authentication failed'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should log FAILED on auth_expired', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['auth_expired']?.();

    await parsePromise;
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should log connection error', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['error']?.(new Error('network issue'));

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('network issue'));

    // Clean up by triggering connected
    clientEventHandlers['connected']?.();
    await parsePromise;
  });

  it('should timeout if no connection within timeout period', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status', '--timeout', '5000']);

    // Advance timer past timeout
    await vi.advanceTimersByTimeAsync(5001);

    await parsePromise;
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should call connect on the client', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectCalled).toBe(true);

    // Clean up
    clientEventHandlers['connected']?.();
    await parsePromise;
  });
});

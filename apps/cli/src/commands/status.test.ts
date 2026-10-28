import type * as DeviceGatewayClientModule from '@lobechat/device-gateway-client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPublicLambdaClient } from '../api/client';
import { resolveToken } from '../auth/resolveToken';
import { loadDeviceGatewayUrl, saveDeviceGatewayUrl } from '../settings';
import { log } from '../utils/logger';
import { registerStatusCommand } from './status';

const OFFICIAL_AUTH = {
  serverUrl: 'https://app.lobehub.com',
  token: 'test-token',
  tokenType: 'jwt' as const,
  userId: 'test-user',
};
const SELF_HOSTED = 'https://self-hosted.example.com';

// Mock resolveToken
vi.mock('../auth/resolveToken', () => ({ resolveToken: vi.fn() }));
vi.mock('../settings', () => ({
  loadDeviceGatewayUrl: vi.fn(),
  saveDeviceGatewayUrl: vi.fn(),
}));

// `config.getGlobalConfig` on the server the token belongs to.
const getGlobalConfig = vi.fn();
vi.mock('../api/client', () => ({
  createPublicLambdaClient: vi.fn(() => ({
    config: { getGlobalConfig: { query: getGlobalConfig } },
  })),
}));

// Track event handlers registered on GatewayClient instances
let clientEventHandlers: Record<string, (...args: any[]) => any> = {};
let connectCalled = false;
let clientOptions: any = {};

vi.mock('@lobechat/device-gateway-client', async (importOriginal) => ({
  // The address resolution is real; only the socket is faked.
  ...(await importOriginal<typeof DeviceGatewayClientModule>()),
  // A plain function, not an arrow: the command calls `new GatewayClient(...)`,
  // and an arrow implementation is not constructible.
  GatewayClient: vi.fn().mockImplementation(function (opts: any) {
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

describe('status command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    clientOptions = {};
    vi.mocked(resolveToken).mockResolvedValue(OFFICIAL_AUTH);
    vi.mocked(loadDeviceGatewayUrl).mockReturnValue(undefined);
    getGlobalConfig.mockResolvedValue({ serverConfig: {} });
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

  /** Run `lh status [...args]` until the probe connects. */
  const runConnected = async (...args: string[]) => {
    const parsePromise = createProgram().parseAsync(['node', 'test', 'status', ...args]);
    await vi.advanceTimersByTimeAsync(0);
    clientEventHandlers['connected']?.();
    await parsePromise;
  };

  it("probes the gateway advertised by the token's server when none is saved", async () => {
    vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
    getGlobalConfig.mockResolvedValue({
      serverConfig: { deviceGatewayUrl: 'https://gw.example.com/edge/' },
    });
    // Another server's saved address is never borrowed.
    vi.mocked(loadDeviceGatewayUrl).mockImplementation((server) =>
      server === SELF_HOSTED ? undefined : 'http://localhost:8788',
    );

    await runConnected();

    // The server the token belongs to — never LOBEHUB_SERVER / settings on their own.
    expect(createPublicLambdaClient).toHaveBeenCalledWith(SELF_HOSTED);
    expect(clientOptions.gatewayUrl).toBe('https://gw.example.com/edge');
    expect(clientOptions.serverUrl).toBe(SELF_HOSTED);
    expect(log.info).toHaveBeenCalledWith(
      'Gateway: https://gw.example.com/edge (advertised by the server)',
    );
  });

  it('keeps the official gateway for official cloud when nothing is advertised or saved', async () => {
    await runConnected();

    expect(clientOptions.gatewayUrl).toBe('https://device-gateway.lobehub.com');
  });

  it.each([OFFICIAL_AUTH.serverUrl, SELF_HOSTED])(
    'probes the address saved for the token’s server ahead of its advertisement (%s)',
    async (serverUrl) => {
      vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl });
      vi.mocked(loadDeviceGatewayUrl).mockImplementation((server) =>
        server === serverUrl ? 'https://gw.saved.example' : undefined,
      );
      getGlobalConfig.mockResolvedValue({
        serverConfig: { deviceGatewayUrl: 'https://gw.example.com' },
      });

      await runConnected();

      expect(getGlobalConfig).not.toHaveBeenCalled();
      expect(clientOptions.gatewayUrl).toBe('https://gw.saved.example');
      expect(log.info).toHaveBeenCalledWith(
        'Gateway: https://gw.saved.example (saved for this server)',
      );
    },
  );

  it('asks for a gateway when a self-hosted server advertises none and none is saved', async () => {
    vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });

    await expect(createProgram().parseAsync(['node', 'test', 'status'])).rejects.toThrow(
      'process.exit',
    );

    expect(log.error).toHaveBeenCalledWith(
      `FAILED - ${SELF_HOSTED} does not advertise a device gateway, and none is saved for it.`,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--gateway <url>'));
    expect(clientOptions).toEqual({});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([true, false])(
    'does not fall back when the config lookup fails (official: %s)',
    async (official) => {
      if (!official)
        vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
      getGlobalConfig.mockRejectedValue(new Error('Unexpected token < in JSON'));

      await expect(createProgram().parseAsync(['node', 'test', 'status'])).rejects.toThrow(
        'process.exit',
      );

      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not read the device gateway address'),
      );
      expect(clientOptions).toEqual({});
    },
  );

  it('uses --gateway without a lookup and saves it for that server', async () => {
    vi.mocked(resolveToken).mockResolvedValue({ ...OFFICIAL_AUTH, serverUrl: SELF_HOSTED });
    getGlobalConfig.mockRejectedValue(new Error('server down'));

    await runConnected('--gateway', 'https://gateway.example.com/');

    expect(getGlobalConfig).not.toHaveBeenCalled();
    expect(clientOptions.gatewayUrl).toBe('https://gateway.example.com');
    expect(saveDeviceGatewayUrl).toHaveBeenCalledWith(SELF_HOSTED, 'https://gateway.example.com');
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

  it('should point a failed handshake at doctor', async () => {
    const program = createProgram();
    const parsePromise = program.parseAsync(['node', 'test', 'status']);
    await vi.advanceTimersByTimeAsync(0);

    clientEventHandlers['auth_failed']?.('signature verification failed');

    await parsePromise;
    expect(log.error).toHaveBeenCalledWith(
      "Run 'lh doctor --profile connect' for a full diagnosis.",
    );
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

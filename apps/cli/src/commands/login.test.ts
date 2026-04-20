import fs from 'node:fs';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserIdFromApiKey } from '../auth/apiKey';
import { saveCredentials } from '../auth/credentials';
import { loadSettings, saveSettings } from '../settings';
import { log } from '../utils/logger';
import { registerLoginCommand, resolveCommandExecutable } from './login';

vi.mock('../auth/apiKey', () => ({
  getUserIdFromApiKey: vi.fn(),
}));
vi.mock('../auth/credentials', () => ({
  saveCredentials: vi.fn(),
}));
vi.mock('../settings', () => ({
  loadSettings: vi.fn().mockReturnValue(null),
  saveSettings: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock child_process to prevent browser opening
vi.mock('node:child_process', () => ({
  default: {
    exec: vi.fn((_cmd: string, cb: any) => cb?.(null)),
    execFile: vi.fn((_cmd: string, _args: string[], cb: any) => cb?.(null)),
  },
  exec: vi.fn((_cmd: string, cb: any) => cb?.(null)),
  execFile: vi.fn((_cmd: string, _args: string[], cb: any) => cb?.(null)),
}));

describe('login command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalApiKey = process.env.LOBEHUB_CLI_API_KEY;
  const originalPath = process.env.PATH;
  const originalPathext = process.env.PATHEXT;
  const originalSystemRoot = process.env.SystemRoot;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.mocked(loadSettings).mockReturnValue(null);
    delete process.env.LOBEHUB_CLI_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
    process.env.LOBEHUB_CLI_API_KEY = originalApiKey;
    process.env.PATH = originalPath;
    process.env.PATHEXT = originalPathext;
    process.env.SystemRoot = originalSystemRoot;
    vi.restoreAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program);
    return program;
  }

  function deviceAuthResponse(overrides: Record<string, any> = {}) {
    return {
      json: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        expires_in: 600,
        interval: 1,
        user_code: 'USER-CODE',
        verification_uri: 'https://app.lobehub.com/verify',
        verification_uri_complete: 'https://app.lobehub.com/verify?code=USER-CODE',
        ...overrides,
      }),
      ok: true,
    } as any;
  }

  function tokenSuccessResponse(overrides: Record<string, any> = {}) {
    return {
      json: vi.fn().mockResolvedValue({
        access_token: 'new-token',
        expires_in: 3600,
        refresh_token: 'refresh-tok',
        token_type: 'Bearer',
        ...overrides,
      }),
      ok: true,
    } as any;
  }

  function tokenErrorResponse(error: string, description?: string) {
    return {
      json: vi.fn().mockResolvedValue({
        error,
        error_description: description,
      }),
      ok: true,
    } as any;
  }

  async function runLogin(program: Command, args: string[] = []) {
    return program.parseAsync(['node', 'test', 'login', ...args]);
  }

  async function runLoginAndAdvanceTimers(program: Command, args: string[] = []) {
    const parsePromise = runLogin(program, args);
    // Advance timers to let sleep resolve in the polling loop
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    return parsePromise;
  }

  it('should complete login flow successfully', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenErrorResponse('authorization_pending'))
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-token',
        refreshToken: 'refresh-tok',
      }),
    );
    expect(saveSettings).toHaveBeenCalledWith({ serverUrl: 'https://app.lobehub.com' });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Login successful'));
  });

  it('should use environment api key without storing credentials', async () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-env-test';
    vi.mocked(getUserIdFromApiKey).mockResolvedValue('user-123');

    const program = createProgram();
    await runLogin(program);

    expect(getUserIdFromApiKey).toHaveBeenCalledWith('sk-lh-env-test', 'https://app.lobehub.com');
    expect(saveCredentials).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith({ serverUrl: 'https://app.lobehub.com' });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Login successful'));
  });

  it('should persist custom server into settings', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program, ['--server', 'https://test.com/']);

    expect(saveSettings).toHaveBeenCalledWith({ serverUrl: 'https://test.com' });
  });

  it('should preserve existing gateway when logging into the same server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://test.com',
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program, ['--server', 'https://test.com/']);

    expect(saveSettings).toHaveBeenCalledWith({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://test.com',
    });
  });

  it('should preserve existing gateway for environment api key on the same server', async () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-env-test';
    vi.mocked(getUserIdFromApiKey).mockResolvedValue('user-123');
    vi.mocked(loadSettings).mockReturnValueOnce({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://test.com',
    });

    const program = createProgram();
    await runLogin(program, ['--server', 'https://test.com/']);

    expect(saveSettings).toHaveBeenCalledWith({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://test.com',
    });
  });

  it('should clear existing gateway when logging into a different server', async () => {
    vi.mocked(loadSettings).mockReturnValueOnce({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://old.example.com',
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program, ['--server', 'https://new.example.com/']);

    expect(saveSettings).toHaveBeenCalledWith({ serverUrl: 'https://new.example.com' });
  });

  it('should strip trailing slash from server URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program, ['--server', 'https://test.com/']);

    expect(fetch).toHaveBeenCalledWith('https://test.com/oidc/device/auth', expect.any(Object));
  });

  it('should handle device auth failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Server Error'),
    } as any);

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to start'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle network error on device auth', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to reach'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle access_denied error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse({ expires_in: 2 }))
      .mockResolvedValueOnce(tokenErrorResponse('access_denied'));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('denied'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle expired_token error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse({ expires_in: 2 }))
      .mockResolvedValueOnce(tokenErrorResponse('expired_token'));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle slow_down by increasing interval', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenErrorResponse('slow_down'))
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(saveCredentials).toHaveBeenCalled();
  });

  it('should handle unknown error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse({ expires_in: 2 }))
      .mockResolvedValueOnce(tokenErrorResponse('server_error', 'Something went wrong'));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('server_error'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle network error during polling', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(saveCredentials).toHaveBeenCalled();
  });

  it('should handle token without expires_in', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse())
      .mockResolvedValueOnce(tokenSuccessResponse({ expires_in: undefined }));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(saveCredentials).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: undefined }));
  });

  it('should use default interval when not provided', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(deviceAuthResponse({ interval: undefined }))
      .mockResolvedValueOnce(tokenSuccessResponse());

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(saveCredentials).toHaveBeenCalled();
  });

  it('should handle device code expiration during polling', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(deviceAuthResponse({ expires_in: 0 }));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should resolve Windows executable via PATHEXT', () => {
    process.env.PATH = 'C:\\Tools';
    process.env.PATHEXT = '.EXE;.CMD';
    process.env.SystemRoot = 'C:\\Windows';

    vi.spyOn(fs, 'existsSync').mockImplementation(
      (targetPath) => String(targetPath).toLowerCase() === 'c:\\tools\\rundll32.exe',
    );

    const resolved = resolveCommandExecutable('rundll32', 'win32');
    expect(resolved?.toLowerCase()).toBe('c:\\tools\\rundll32.exe');
  });
});

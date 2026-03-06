import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveCredentials } from '../auth/credentials';
import { log } from '../utils/logger';
import { registerLoginCommand } from './login';

vi.mock('../auth/credentials', () => ({
  saveCredentials: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock child_process.exec to prevent browser opening
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, cb: any) => cb?.(null)),
}));

describe('login command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
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

  async function runLoginAndAdvanceTimers(program: Command, args: string[] = []) {
    const parsePromise = program.parseAsync(['node', 'test', 'login', ...args]);
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
        serverUrl: 'https://app.lobehub.com',
      }),
    );
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Login successful'));
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
    // For early-exit tests, process.exit must throw to stop code execution
    // (otherwise code continues past exit and accesses undefined deviceAuth)
    exitSpy.mockImplementation(() => {
      throw new Error('exit');
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Server Error'),
    } as any);

    const program = createProgram();
    await runLoginAndAdvanceTimers(program).catch(() => {});

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Failed to start'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle network error on device auth', async () => {
    exitSpy.mockImplementation(() => {
      throw new Error('exit');
    });

    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const program = createProgram();
    await runLoginAndAdvanceTimers(program).catch(() => {});

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
});

import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchClaudeCodeQuota } from './claudeCodeQuota';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node:os', () => ({
  homedir: () => '/home/test',
}));

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

const setPlatform = (value: string) => {
  Object.defineProperty(process, 'platform', { configurable: true, value });
};

const mockKeychain = (result: string | Error) => {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
      if (result instanceof Error) callback(result, '', '');
      else callback(null, `${result}\n`, '');
    },
  );
};

const credentialsJson = (expiresAt: number, accessToken = 'file-token') =>
  JSON.stringify({ claudeAiOauth: { accessToken, expiresAt, refreshToken: 'refresh' } });

const okUsageResponse = (payload: unknown) =>
  ({ json: async () => payload, ok: true, status: 200 }) as Response;

const NOW = new Date('2026-07-02T12:00:00Z').getTime();
const FRESH_EXPIRES_AT = NOW + 60 * 60 * 1000;
const STALE_EXPIRES_AT = NOW - 60 * 60 * 1000;

describe('fetchClaudeCodeQuota', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    vi.mocked(readFile).mockReset();
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    execFileMock.mockReset();
    mockKeychain(new Error('keychain unavailable'));
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports external auth without touching credentials when an Anthropic auth env is set', async () => {
    const result = await fetchClaudeCodeQuota({ env: { ANTHROPIC_API_KEY: 'sk-test' } });

    expect(result).toMatchObject({
      provider: 'claude-code',
      reason: 'external-auth',
      status: 'unavailable',
    });
    expect(result.error).toContain('ANTHROPIC_API_KEY');
    expect(execFileMock).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports external auth for third-party routing flags like Bedrock', async () => {
    const result = await fetchClaudeCodeQuota({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } });

    expect(result).toMatchObject({ reason: 'external-auth', status: 'unavailable' });
    expect(result.error).toContain('CLAUDE_CODE_USE_BEDROCK');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honors routing flags inherited from the desktop process env', async () => {
    vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '1');

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({ reason: 'external-auth', status: 'unavailable' });
    expect(result.error).toContain('CLAUDE_CODE_USE_VERTEX');
  });

  it('lets the agent env disable an inherited routing flag', async () => {
    setPlatform('linux');
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue(okUsageResponse({ five_hour: { utilization: 10 } }));

    const result = await fetchClaudeCodeQuota({ env: { CLAUDE_CODE_USE_BEDROCK: '0' } });

    expect(result.status).toBe('ok');
  });

  it('ignores disabled routing flags and falls through to the credential lookup', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue(okUsageResponse({ five_hour: { utilization: 10 } }));

    const result = await fetchClaudeCodeQuota({
      env: { CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: 'false' },
    });

    expect(result.status).toBe('ok');
  });

  it('reports missing credentials when neither keychain nor files hold a login', async () => {
    setPlatform('darwin');

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({ reason: 'credentials-not-found', status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports expired credentials instead of refreshing them', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(STALE_EXPIRES_AT));

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({ reason: 'credentials-expired', status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps usage windows from a keychain login on macOS', async () => {
    setPlatform('darwin');
    mockKeychain(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'keychain-token', expiresAt: FRESH_EXPIRES_AT },
      }),
    );
    vi.mocked(fetch).mockResolvedValue(
      okUsageResponse({
        five_hour: { resets_at: '2026-07-02T14:30:00Z', utilization: 35 },
        seven_day: { resets_at: '2026-07-08T12:00:00Z', utilization: 62.5 },
      }),
    );

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({
      error: null,
      provider: 'claude-code',
      scopedWeekly: null,
      session: {
        resetsAt: Date.parse('2026-07-02T14:30:00Z'),
        usedPercent: 35,
        windowMinutes: 300,
      },
      status: 'ok',
      weekly: {
        resetsAt: Date.parse('2026-07-08T12:00:00Z'),
        usedPercent: 62.5,
        windowMinutes: 10_080,
      },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer keychain-token',
          'anthropic-beta': 'oauth-2025-04-20',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('reads the CLAUDE_CONFIG_DIR profile credentials file and the used_percentage field', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (file === '/custom/claude/.credentials.json') {
        return credentialsJson(FRESH_EXPIRES_AT, 'custom-token');
      }
      throw new Error('ENOENT');
    });
    // resets_at in unix seconds; used_percentage instead of utilization
    vi.mocked(fetch).mockResolvedValue(
      okUsageResponse({
        five_hour: { resets_at: 1_782_741_600, used_percentage: 140 },
      }),
    );

    const result = await fetchClaudeCodeQuota({ env: { CLAUDE_CONFIG_DIR: '/custom/claude' } });

    expect(result.status).toBe('ok');
    // clamped to 100, seconds converted to ms
    expect(result.session).toEqual({
      resetsAt: 1_782_741_600 * 1000,
      usedPercent: 100,
      windowMinutes: 300,
    });
    expect(result.weekly).toBeNull();
    expect(readFile).toHaveBeenCalledWith('/custom/claude/.credentials.json', 'utf8');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer custom-token' }),
      }),
    );
  });

  it('prefers the CLAUDE_CONFIG_DIR profile over a fresh default keychain login', async () => {
    setPlatform('darwin');
    mockKeychain(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'default-account-token', expiresAt: FRESH_EXPIRES_AT },
      }),
    );
    vi.mocked(readFile).mockImplementation(async (file) => {
      if (file === '/custom/claude/.credentials.json') {
        return credentialsJson(FRESH_EXPIRES_AT, 'profile-token');
      }
      throw new Error('ENOENT');
    });
    vi.mocked(fetch).mockResolvedValue(okUsageResponse({ five_hour: { utilization: 10 } }));

    const result = await fetchClaudeCodeQuota({ env: { CLAUDE_CONFIG_DIR: '/custom/claude' } });

    expect(result.status).toBe('ok');
    // The custom profile's token is used and the default keychain is never consulted.
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer profile-token' }),
      }),
    );
  });

  it('reports not-found for an unauthenticated CLAUDE_CONFIG_DIR profile instead of falling back', async () => {
    setPlatform('darwin');
    mockKeychain(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'default-account-token', expiresAt: FRESH_EXPIRES_AT },
      }),
    );

    const result = await fetchClaudeCodeQuota({ env: { CLAUDE_CONFIG_DIR: '/custom/claude' } });

    expect(result).toMatchObject({ reason: 'credentials-not-found', status: 'unavailable' });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prefers a fresh file login over an expired keychain login', async () => {
    setPlatform('darwin');
    mockKeychain(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'stale-keychain-token', expiresAt: STALE_EXPIRES_AT },
      }),
    );
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT, 'fresh-file-token'));
    vi.mocked(fetch).mockResolvedValue(okUsageResponse({ five_hour: { utilization: 10 } }));

    const result = await fetchClaudeCodeQuota();

    expect(result.status).toBe('ok');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-file-token' }),
      }),
    );
  });

  it('maps the model-scoped weekly window from the limits array (real response shape)', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    // Trimmed from a real /api/oauth/usage 200 response (2026-07-03).
    vi.mocked(fetch).mockResolvedValue(
      okUsageResponse({
        five_hour: { resets_at: '2026-07-03T12:00:00.241917+00:00', utilization: 5 },
        limits: [
          {
            is_active: false,
            kind: 'session',
            percent: 5,
            resets_at: '2026-07-03T12:00:00.241917+00:00',
            scope: null,
            severity: 'normal',
          },
          {
            is_active: false,
            kind: 'weekly_all',
            percent: 13,
            resets_at: '2026-07-06T01:00:00.241941+00:00',
            scope: null,
            severity: 'normal',
          },
          {
            is_active: true,
            kind: 'weekly_scoped',
            percent: 24,
            resets_at: '2026-07-06T01:00:00.242225+00:00',
            scope: { model: { display_name: 'Fable', id: null }, surface: null },
            severity: 'normal',
          },
        ],
        seven_day: { resets_at: '2026-07-06T01:00:00.241941+00:00', utilization: 13 },
        seven_day_opus: null,
        seven_day_sonnet: null,
      }),
    );

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({
      scopedWeekly: {
        modelName: 'Fable',
        window: {
          resetsAt: Date.parse('2026-07-06T01:00:00.242225+00:00'),
          usedPercent: 24,
          windowMinutes: 10_080,
        },
      },
      session: { usedPercent: 5, windowMinutes: 300 },
      status: 'ok',
      weekly: { usedPercent: 13, windowMinutes: 10_080 },
    });
  });

  it('falls back to legacy fable_weekly fields when limits are absent', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue(
      okUsageResponse({
        fable_weekly: { resets_at: '2026-07-08T12:00:00Z', utilization: 80 },
        five_hour: { utilization: 20 },
        seven_day: { utilization: 45 },
      }),
    );

    const result = await fetchClaudeCodeQuota();

    expect(result.scopedWeekly).toEqual({
      modelName: 'Fable',
      window: {
        resetsAt: Date.parse('2026-07-08T12:00:00Z'),
        usedPercent: 80,
        windowMinutes: 10_080,
      },
    });
  });

  it('treats a 401 as an expired login', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({ reason: 'credentials-expired', status: 'unavailable' });
    expect(result.error).toContain('401');
  });

  it('surfaces a 429 as a transient error', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429 } as Response);

    const result = await fetchClaudeCodeQuota();

    expect(result).toMatchObject({ status: 'error' });
    expect(result.reason).toBeUndefined();
    expect(result.error).toContain('429');
  });

  it('aborts a hanging usage request and reports a timeout', async () => {
    setPlatform('linux');
    vi.mocked(readFile).mockResolvedValue(credentialsJson(FRESH_EXPIRES_AT));
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const resultPromise = fetchClaudeCodeQuota();
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
  });
});

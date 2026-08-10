import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

describe('sendSecurityAlert / recordAuthAbuseSignal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.resetModules();
  });

  it('posts webhook when configured and no cooldown row exists', async () => {
    vi.doMock('@/envs/aico', () => ({
      aicoEnv: {
        AICO_SECURITY_ALERT_WEBHOOK_URL: 'https://hooks.example.com/aico',
      },
    }));

    const insertValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    const db = {
      insert: vi.fn(() => ({ values: insertValues })),
      query: {
        aicoSecurityAlertState: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      update: vi.fn(),
    };

    const { sendSecurityAlert } = await import('./securityAlert');
    const result = await sendSecurityAlert(db as never, {
      severity: 'warning',
      summary: 'test alert',
      type: 'outbox.exhausted',
    });

    expect(result.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/aico',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('skips send during cooldown', async () => {
    vi.doMock('@/envs/aico', () => ({
      aicoEnv: { AICO_SECURITY_ALERT_WEBHOOK_URL: 'https://hooks.example.com/aico' },
    }));

    const db = {
      insert: vi.fn(),
      query: {
        aicoSecurityAlertState: {
          findFirst: vi.fn().mockResolvedValue({
            hitCount: 1,
            id: 'outbox.exhausted',
            lastAlertedAt: new Date(),
          }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    const { sendSecurityAlert } = await import('./securityAlert');
    const result = await sendSecurityAlert(db as never, {
      severity: 'critical',
      summary: 'again',
      type: 'outbox.exhausted',
    });

    expect(result.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses in-memory cooldown when db is null', async () => {
    vi.doMock('@/envs/aico', () => ({
      aicoEnv: { AICO_SECURITY_ALERT_WEBHOOK_URL: 'https://hooks.example.com/aico' },
    }));

    const { resetAuthAbuseSignalsForTests, sendSecurityAlert } = await import('./securityAlert');
    resetAuthAbuseSignalsForTests();

    const first = await sendSecurityAlert(null, {
      dedupeKey: 'memory-cooldown-test',
      severity: 'warning',
      summary: 'first',
      type: 'auth.otp_abuse',
    });
    const second = await sendSecurityAlert(null, {
      dedupeKey: 'memory-cooldown-test',
      severity: 'warning',
      summary: 'second',
      type: 'auth.otp_abuse',
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('alerts after auth abuse threshold', async () => {
    vi.doMock('@/envs/aico', () => ({
      aicoEnv: { AICO_SECURITY_ALERT_WEBHOOK_URL: undefined },
    }));

    const { recordAuthAbuseSignal, resetAuthAbuseSignalsForTests } =
      await import('./securityAlert');
    resetAuthAbuseSignalsForTests();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    for (let i = 0; i < 4; i++) {
      await recordAuthAbuseSignal(null, {
        key: 'ip-1',
        kind: 'rate_limit',
        threshold: 5,
        windowMs: 60_000,
      });
    }
    expect(consoleSpy).not.toHaveBeenCalledWith('[aico-security-alert]', expect.any(String));

    await recordAuthAbuseSignal(null, {
      key: 'ip-1',
      kind: 'rate_limit',
      threshold: 5,
      windowMs: 60_000,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[aico-security-alert]',
      expect.stringContaining('auth.rate_limit_burst'),
    );

    consoleSpy.mockRestore();
  });
});

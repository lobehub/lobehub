import { afterEach, describe, expect, it, vi } from 'vitest';

describe('assertMockTopupAllowed (final remediation)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('always rejects in production even if AICO_ALLOW_MOCK_TOPUP=1', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AICO_ALLOW_MOCK_TOPUP', '1');
    const { assertMockTopupAllowed } = await import('./mockTopupGate');
    expect(() => assertMockTopupAllowed()).toThrow(/MOCK_TOPUP_DISABLED/);
  });

  it('rejects in non-production without explicit enablement', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AICO_ALLOW_MOCK_TOPUP', '0');
    const { assertMockTopupAllowed } = await import('./mockTopupGate');
    expect(() => assertMockTopupAllowed()).toThrow(/MOCK_TOPUP_DISABLED/);
  });

  it('allows in non-production when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AICO_ALLOW_MOCK_TOPUP', '1');
    const { assertMockTopupAllowed, isMockTopupUiEnabled } = await import('./mockTopupGate');
    expect(() => assertMockTopupAllowed()).not.toThrow();
    expect(isMockTopupUiEnabled()).toBe(true);
  });
});

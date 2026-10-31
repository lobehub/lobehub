// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signLlmRelayLease, verifyLlmRelayLease } from './protocol';

describe('LLM relay lease rotation', () => {
  const originalActive = process.env.KEY_VAULTS_SECRET;
  const originalFallback = process.env.KEY_VAULTS_FALLBACK_SECRET;

  beforeEach(() => {
    process.env.KEY_VAULTS_SECRET = 'old-secret';
    delete process.env.KEY_VAULTS_FALLBACK_SECRET;
  });

  afterEach(() => {
    if (originalActive === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = originalActive;
    if (originalFallback === undefined) delete process.env.KEY_VAULTS_FALLBACK_SECRET;
    else process.env.KEY_VAULTS_FALLBACK_SECRET = originalFallback;
  });

  it('accepts an unexpired lease signed by the fallback secret', () => {
    const now = Date.now();
    const token = signLlmRelayLease({ callId: 'call-1', exp: now + 60_000, userId: 'user-1' });

    process.env.KEY_VAULTS_SECRET = 'new-secret';
    process.env.KEY_VAULTS_FALLBACK_SECRET = 'old-secret';

    expect(verifyLlmRelayLease(token, 'call-1', now)).toEqual({
      callId: 'call-1',
      exp: now + 60_000,
      userId: 'user-1',
    });
  });

  it('signs new leases only with the active secret', () => {
    const now = Date.now();
    process.env.KEY_VAULTS_FALLBACK_SECRET = 'fallback-secret';
    const token = signLlmRelayLease({ callId: 'call-2', exp: now + 60_000, userId: 'user-2' });

    process.env.KEY_VAULTS_SECRET = 'fallback-secret';
    delete process.env.KEY_VAULTS_FALLBACK_SECRET;

    expect(verifyLlmRelayLease(token, 'call-2', now)).toBeUndefined();
  });
});

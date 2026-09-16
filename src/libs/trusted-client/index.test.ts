import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateTrustedClientToken, isSyntheticTrustedClientUserId } from './index';

vi.mock('@/envs/app', () => ({
  appEnv: {
    MARKET_TRUSTED_CLIENT_ID: 'client-id',
    MARKET_TRUSTED_CLIENT_SECRET: 'client-secret',
  },
}));

vi.mock('@lobehub/market-sdk', () => ({
  buildTrustedClientPayload: vi.fn((params) => ({ ...params, nonce: 'n', timestamp: 0 })),
  createTrustedClientToken: vi.fn(() => 'signed-token'),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSyntheticTrustedClientUserId', () => {
  it('flags eval_ and qstash_smoke_ prefixed ids', () => {
    expect(isSyntheticTrustedClientUserId('eval_123')).toBe(true);
    expect(isSyntheticTrustedClientUserId('qstash_smoke_abc')).toBe(true);
  });

  it('does not flag real user ids or near-misses', () => {
    expect(isSyntheticTrustedClientUserId('user_2abc')).toBe(false);
    // "evaluator_" starts with "eval" but not the "eval_" prefix
    expect(isSyntheticTrustedClientUserId('evaluator_1')).toBe(false);
    // prefix must be at the start
    expect(isSyntheticTrustedClientUserId('abc-eval_1')).toBe(false);
  });
});

describe('generateTrustedClientToken', () => {
  it('returns undefined for synthetic eval/smoke userIds without signing', () => {
    expect(generateTrustedClientToken({ userId: 'eval_xyz' })).toBeUndefined();
    expect(generateTrustedClientToken({ userId: 'qstash_smoke_1' })).toBeUndefined();
    expect(buildTrustedClientPayload).not.toHaveBeenCalled();
    expect(createTrustedClientToken).not.toHaveBeenCalled();
  });

  it('signs a token for a real userId', () => {
    const token = generateTrustedClientToken({ email: 'a@b.com', userId: 'user_real' });

    expect(token).toBe('signed-token');
    expect(buildTrustedClientPayload).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-id', userId: 'user_real' }),
    );
    expect(createTrustedClientToken).toHaveBeenCalledWith(expect.anything(), 'client-secret');
  });

  // The claim is what the execution plane routes a persistent sandbox on, so it
  // has to be covered by the signature — a caller must not be able to supply it
  // alongside the token.
  it('signs the sandbox workspace claim into the payload', () => {
    generateTrustedClientToken({
      email: 'a@b.com',
      sandboxWorkspace: { key: 'ws-user_real', quotaBytes: 2048 },
      userId: 'user_real',
    });

    expect(createTrustedClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxWorkspace: { key: 'ws-user_real', quotaBytes: 2048 } }),
      'client-secret',
    );
  });

  // The published SDK builder has no parameter for it, so the field is attached
  // afterwards; passing it in would be silently dropped.
  it('does not route the claim through the SDK payload builder', () => {
    generateTrustedClientToken({
      sandboxWorkspace: { key: 'ws-user_real', quotaBytes: 2048 },
      userId: 'user_real',
    });

    expect(buildTrustedClientPayload).toHaveBeenCalledWith(
      expect.not.objectContaining({ sandboxWorkspace: expect.anything() }),
    );
  });

  // Free tier is the overwhelming majority of tokens; leaving the key out keeps
  // them exactly as they are today rather than carrying an explicit null.
  it('omits the claim entirely when there is no entitlement', () => {
    generateTrustedClientToken({ sandboxWorkspace: null, userId: 'user_real' });

    const [payload] = vi.mocked(createTrustedClientToken).mock.calls[0];
    expect(payload).not.toHaveProperty('sandboxWorkspace');
  });
});

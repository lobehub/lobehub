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
});

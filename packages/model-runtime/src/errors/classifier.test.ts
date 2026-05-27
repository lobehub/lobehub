import { describe, expect, it } from 'vitest';

import { isAccountDeactivatedError } from '../utils/isAccountDeactivatedError';
import { isExceededContextWindowError } from '../utils/isExceededContextWindowError';
import { isInsufficientQuotaError } from '../utils/isInsufficientQuotaError';
import { isQuotaLimitError } from '../utils/isQuotaLimitError';
import { ErrorClassifier } from './classifier';

describe('ErrorClassifier', () => {
  it('returns false for empty input', () => {
    expect(ErrorClassifier.isExceededContextWindow(undefined)).toBe(false);
    expect(ErrorClassifier.isInsufficientQuota('')).toBe(false);
    expect(ErrorClassifier.isQuotaLimitReached(undefined)).toBe(false);
    expect(ErrorClassifier.isAccountDeactivated('')).toBe(false);
  });

  it('agrees with the legacy isExceededContextWindowError util', () => {
    const samples = [
      "This model's maximum context length is 131072 tokens",
      'prompt is too long: 231426 tokens > 200000 maximum',
      'context_length_exceeded',
      'MAXIMUM CONTEXT LENGTH exceeded',
      // negatives
      'Invalid API key',
      'Rate limit exceeded',
      'Internal server error',
    ];
    for (const msg of samples) {
      expect(ErrorClassifier.isExceededContextWindow(msg)).toBe(isExceededContextWindowError(msg));
    }
  });

  it('agrees with the legacy isInsufficientQuotaError util', () => {
    const samples = [
      'Your account org-X is suspended due to insufficient balance, please recharge',
      'Insufficient Balance: Your account balance is too low',
      'Billing hard limit has been reached',
      // negatives
      'Your account has been deactivated',
      'Rate limit reached',
      'Context length exceeded',
    ];
    for (const msg of samples) {
      expect(ErrorClassifier.isInsufficientQuota(msg)).toBe(isInsufficientQuotaError(msg));
    }
  });

  it('agrees with the legacy isQuotaLimitError util', () => {
    const samples = [
      'Resource exhausted',
      'rate_limit_exceeded',
      'Too many requests',
      // negatives
      'Insufficient balance',
      'Context length exceeded',
    ];
    for (const msg of samples) {
      expect(ErrorClassifier.isQuotaLimitReached(msg)).toBe(isQuotaLimitError(msg));
    }
  });

  it('agrees with the legacy isAccountDeactivatedError util', () => {
    const samples = [
      'Your account has been deactivated, please contact support',
      'Your account has been suspended due to policy violation',
      // billing suspension shouldn't fire here
      'Your account is suspended due to insufficient balance, please recharge',
      // unrelated
      'Invalid API key',
    ];
    for (const msg of samples) {
      expect(ErrorClassifier.isAccountDeactivated(msg)).toBe(isAccountDeactivatedError(msg));
    }
  });
});

import { describe, expect, it } from 'vitest';

import { ErrorClassifier } from './classifier';

describe('ErrorClassifier', () => {
  it('returns false for empty input', () => {
    expect(ErrorClassifier.isExceededContextWindow(undefined)).toBe(false);
    expect(ErrorClassifier.isInsufficientQuota('')).toBe(false);
    expect(ErrorClassifier.isRateLimitExceeded(undefined)).toBe(false);
    expect(ErrorClassifier.isAccountDeactivated('')).toBe(false);
  });

  it.each([
    ["This model's maximum context length is 131072 tokens", true],
    ['prompt is too long: 231426 tokens > 200000 maximum', true],
    ['context_length_exceeded', true],
    ['MAXIMUM CONTEXT LENGTH exceeded', true],
    ['Invalid API key', false],
    ['Rate limit exceeded', false],
    ['Internal server error', false],
  ])('isExceededContextWindow(%j) → %s', (msg, expected) => {
    expect(ErrorClassifier.isExceededContextWindow(msg)).toBe(expected);
  });

  it.each([
    ['Your account org-X is suspended due to insufficient balance, please recharge', true],
    ['Insufficient Balance: Your account balance is too low', true],
    ['Billing hard limit has been reached', true],
    ['Your account has been deactivated', false],
    ['Rate limit reached', false],
    ['Context length exceeded', false],
  ])('isInsufficientQuota(%j) → %s', (msg, expected) => {
    expect(ErrorClassifier.isInsufficientQuota(msg)).toBe(expected);
  });

  it.each([
    ['Resource exhausted', true],
    ['rate_limit_exceeded', true],
    ['Too many requests', true],
    ['Insufficient balance', false],
    ['Context length exceeded', false],
  ])('isRateLimitExceeded(%j) → %s', (msg, expected) => {
    expect(ErrorClassifier.isRateLimitExceeded(msg)).toBe(expected);
  });

  it.each([
    ['Your account has been deactivated, please contact support', true],
    ['Your account has been suspended due to policy violation', true],
    // billing-suspension shouldn't fire as account-deactivation
    ['Your account is suspended due to insufficient balance, please recharge', false],
    ['Invalid API key', false],
  ])('isAccountDeactivated(%j) → %s', (msg, expected) => {
    expect(ErrorClassifier.isAccountDeactivated(msg)).toBe(expected);
  });

  it('isQuotaLimitReached is a deprecated alias for isRateLimitExceeded', () => {
    expect(ErrorClassifier.isQuotaLimitReached('Too many requests')).toBe(true);
    expect(ErrorClassifier.isQuotaLimitReached('Invalid API key')).toBe(false);
  });
});

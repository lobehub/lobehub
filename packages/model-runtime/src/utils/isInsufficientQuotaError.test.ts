import { describe, expect, it } from 'vitest';

import { isInsufficientQuotaError } from './isInsufficientQuotaError';

describe('isInsufficientQuotaError', () => {
  it('should return false for undefined/empty input', () => {
    expect(isInsufficientQuotaError(undefined)).toBe(false);
    expect(isInsufficientQuotaError('')).toBe(false);
  });

  it('should detect Moonshot "insufficient balance" errors', () => {
    expect(
      isInsufficientQuotaError(
        'Your account org-d4cffdc846304e378e12254ef3c9cb16 <ak-f8fmexq3k3wi11gm63d1> is suspended due to insufficient balance, please recharge your account or check your plan and billing details',
      ),
    ).toBe(true);
  });

  it('should detect generic "Insufficient Balance" errors', () => {
    expect(isInsufficientQuotaError('Insufficient Balance: Your account balance is too low')).toBe(
      true,
    );
  });

  it('should detect "insufficient quota" errors', () => {
    expect(isInsufficientQuotaError('You have insufficient quota for this request')).toBe(true);
  });

  it('should detect "balance is not enough" errors', () => {
    expect(isInsufficientQuotaError('Your balance is not enough to complete this request')).toBe(
      true,
    );
  });

  it('should detect OpenAI "billing hard limit" errors', () => {
    expect(isInsufficientQuotaError('Billing hard limit has been reached')).toBe(true);
  });

  it('should NOT detect account deactivation as quota error', () => {
    expect(
      isInsufficientQuotaError('Your account has been deactivated, please contact support'),
    ).toBe(false);
  });

  it('should detect "exceeded your current quota" errors', () => {
    expect(
      isInsufficientQuotaError(
        'You exceeded your current quota, please check your plan and billing details',
      ),
    ).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isInsufficientQuotaError('INSUFFICIENT BALANCE')).toBe(true);
    expect(isInsufficientQuotaError('Insufficient Quota')).toBe(true);
    expect(isInsufficientQuotaError('BILLING HARD LIMIT HAS BEEN REACHED')).toBe(true);
  });

  it('should return false for unrelated error messages', () => {
    expect(isInsufficientQuotaError('Invalid API key')).toBe(false);
    expect(isInsufficientQuotaError('Context length exceeded')).toBe(false);
    expect(isInsufficientQuotaError('Too many requests')).toBe(false);
    expect(isInsufficientQuotaError('Rate limit reached')).toBe(false);
  });
});

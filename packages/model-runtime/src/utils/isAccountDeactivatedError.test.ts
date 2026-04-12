import { describe, expect, it } from 'vitest';

import { isAccountDeactivatedError } from './isAccountDeactivatedError';

describe('isAccountDeactivatedError', () => {
  it('should return false for undefined/empty input', () => {
    expect(isAccountDeactivatedError(undefined)).toBe(false);
    expect(isAccountDeactivatedError('')).toBe(false);
  });

  it('should detect "account has been deactivated" errors', () => {
    expect(
      isAccountDeactivatedError('Your account has been deactivated, please contact support'),
    ).toBe(true);
  });

  it('should detect "account has been suspended" errors', () => {
    expect(
      isAccountDeactivatedError('Your account has been suspended due to policy violation'),
    ).toBe(true);
  });

  it('should detect "account has been disabled" errors', () => {
    expect(isAccountDeactivatedError('This account has been disabled')).toBe(true);
  });

  it('should detect "account is disabled" errors', () => {
    expect(isAccountDeactivatedError('Your account is disabled')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isAccountDeactivatedError('ACCOUNT HAS BEEN DEACTIVATED')).toBe(true);
    expect(isAccountDeactivatedError('Account Has Been Suspended')).toBe(true);
  });

  it('should return false for unrelated error messages', () => {
    expect(isAccountDeactivatedError('Insufficient Balance')).toBe(false);
    expect(isAccountDeactivatedError('Invalid API key')).toBe(false);
    expect(isAccountDeactivatedError('Rate limit reached')).toBe(false);
  });

  it('should NOT match billing-related account suspensions', () => {
    expect(
      isAccountDeactivatedError(
        'Your account is suspended due to insufficient balance, please recharge',
      ),
    ).toBe(false);
  });
});

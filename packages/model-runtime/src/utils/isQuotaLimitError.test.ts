import { describe, expect, it } from 'vitest';

import { isQuotaLimitError } from './isQuotaLimitError';

describe('isQuotaLimitError', () => {
  it('should return false for undefined/empty input', () => {
    expect(isQuotaLimitError(undefined)).toBe(false);
    expect(isQuotaLimitError('')).toBe(false);
  });

  it('should detect Google "resource exhausted" errors', () => {
    expect(isQuotaLimitError('Resource exhausted')).toBe(true);
  });

  it('should detect Google "resource has been exhausted" errors', () => {
    expect(isQuotaLimitError('Resource has been exhausted (e.g. check quota).')).toBe(true);
  });

  it('should detect OpenAI "rate limit reached" errors', () => {
    expect(isQuotaLimitError('Rate limit reached for model gpt-4 in organization')).toBe(true);
  });

  it('should detect OpenAI "rate_limit_exceeded" code in message', () => {
    expect(isQuotaLimitError('Error code: rate_limit_exceeded')).toBe(true);
  });

  it('should detect "quota exceeded" errors', () => {
    expect(isQuotaLimitError('Quota exceeded for this API key')).toBe(true);
  });

  it('should detect "too many requests" errors', () => {
    expect(isQuotaLimitError('Too many requests, please slow down')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isQuotaLimitError('RESOURCE EXHAUSTED')).toBe(true);
    expect(isQuotaLimitError('Rate Limit Reached')).toBe(true);
    expect(isQuotaLimitError('TOO MANY REQUESTS')).toBe(true);
  });

  it('should return false for unrelated error messages', () => {
    expect(isQuotaLimitError('Invalid API key')).toBe(false);
    expect(isQuotaLimitError('Context length exceeded')).toBe(false);
    expect(isQuotaLimitError('Internal server error')).toBe(false);
  });
});

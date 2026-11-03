import { describe, expect, it } from 'vitest';

import { getClientIP } from './clientIP';

describe('getClientIP', () => {
  // Helper function to create Headers object
  const createHeaders = (entries: [string, string][]) => {
    return new Headers(entries);
  };

  it('should return null when no IP headers are present', () => {
    const headers = createHeaders([]);
    expect(getClientIP(headers)).toBe('');
  });

  it('should handle Cloudflare IP header', () => {
    const headers = createHeaders([['cf-connecting-ip', '1.2.3.4']]);
    expect(getClientIP(headers)).toBe('1.2.3.4');
  });

  it('should handle x-forwarded-for with single IP', () => {
    const headers = createHeaders([['x-forwarded-for', '5.6.7.8']]);
    expect(getClientIP(headers)).toBe('5.6.7.8');
  });

  it('should handle x-forwarded-for with multiple IPs and return the first one', () => {
    const headers = createHeaders([['x-forwarded-for', '9.10.11.12, 13.14.15.16, 17.18.19.20']]);
    expect(getClientIP(headers)).toBe('9.10.11.12');
  });

  it('should handle x-real-ip header', () => {
    const headers = createHeaders([['x-real-ip', '21.22.23.24']]);
    expect(getClientIP(headers)).toBe('21.22.23.24');
  });

  it('should trim whitespace from IP addresses', () => {
    const headers = createHeaders([['x-client-ip', '  25.26.27.28  ']]);
    expect(getClientIP(headers)).toBe('25.26.27.28');
  });

  it('should respect header priority order', () => {
    const headers = createHeaders([
      ['x-forwarded-for', '1.1.1.1'],
      ['cf-connecting-ip', '2.2.2.2'], // Should take precedence
      ['x-real-ip', '3.3.3.3'],
    ]);
    expect(getClientIP(headers)).toBe('2.2.2.2');
  });

  it('should handle empty x-forwarded-for value', () => {
    const headers = createHeaders([['x-forwarded-for', '']]);
    expect(getClientIP(headers)).toBe('');
  });
});

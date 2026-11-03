import { describe, expect, it } from 'vitest';

import { desensitizeUrl } from './desensitizeUrl';

describe('desensitizeUrl', () => {
  it('should desensitize a URL with a subdomain', () => {
    const originalUrl = 'https://api.example.com/v1';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://api.ex****le.com/v1');
  });

  it('should desensitize a URL without a subdomain', () => {
    const originalUrl = 'https://example.com/v1';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://ex****le.com/v1');
  });

  it('should desensitize a URL without a subdomain less then 5 chartarters', () => {
    const originalUrl = 'https://abc.com/v1';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://***.com/v1');
  });

  it('should desensitize a URL with multiple subdomains', () => {
    const originalUrl = 'https://sub.api.example.com/v1';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://sub.api.ex****le.com/v1');
  });

  it('should desensitize a URL with path and query parameters', () => {
    const originalUrl = 'https://api.example.com/v1?query=123';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://api.ex****le.com/v1?query=123');
  });

  it('should return the original URL if it is invalid', () => {
    const originalUrl = 'invalidurl';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe(originalUrl);
  });

  it('should desensitize a URL with a port number', () => {
    const originalUrl = 'https://api.example.com:8080/v1';
    const result = desensitizeUrl(originalUrl);
    expect(result).toBe('https://api.ex****le.com:****/v1');
  });
});

import { describe, expect, it } from 'vitest';

import { getRequestClientIP } from './requestClientIP';

describe('getRequestClientIP', () => {
  it('should take the first x-forwarded-for entry before x-real-ip', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.3, 10.0.0.1',
      'x-real-ip': '198.51.100.2',
    });

    expect(getRequestClientIP(headers)).toBe('198.51.100.3');
  });

  it('should fall back to x-real-ip', () => {
    expect(getRequestClientIP(new Headers({ 'x-real-ip': ' 198.51.100.2 ' }))).toBe('198.51.100.2');
  });

  it('should ignore client-suppliable cf-connecting-ip', () => {
    expect(getRequestClientIP(new Headers({ 'cf-connecting-ip': '203.0.113.7' }))).toBeUndefined();
    expect(
      getRequestClientIP(
        new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '198.51.100.2' }),
      ),
    ).toBe('198.51.100.2');
  });

  it('should return undefined without proxy headers', () => {
    expect(getRequestClientIP(new Headers())).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { resolveSafeRedirect } from './redirect';

describe('resolveSafeRedirect', () => {
  it('keeps in-site relative paths', () => {
    expect(resolveSafeRedirect('/chat')).toBe('/chat');
    expect(resolveSafeRedirect('/chat/abc?x=1')).toBe('/chat/abc?x=1');
  });

  it('falls back when the target is missing', () => {
    expect(resolveSafeRedirect(undefined)).toBe('/');
    expect(resolveSafeRedirect(undefined, '/workspace')).toBe('/workspace');
  });

  it.each([
    'https://evil.com',
    'http://evil.com/path',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'chat',
    '',
  ])('refuses unsafe target %s', (target) => {
    expect(resolveSafeRedirect(target)).toBe('/');
    expect(resolveSafeRedirect(target, '/fallback')).toBe('/fallback');
  });

  it('refuses values containing CR/LF (header injection)', () => {
    expect(resolveSafeRedirect('/chat\r\nSet-Cookie: x=1')).toBe('/');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(resolveSafeRedirect('  /chat  ')).toBe('/chat');
  });
});

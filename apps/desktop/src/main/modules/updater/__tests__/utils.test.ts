import { describe, expect, it } from 'vitest';

import { extractRestoreRoute } from '../utils';

describe('extractRestoreRoute', () => {
  it('extracts the route from a production renderer URL', () => {
    expect(extractRestoreRoute('app://renderer/agent/abc')).toBe('/agent/abc');
  });

  it('extracts the route from a dev renderer URL', () => {
    expect(extractRestoreRoute('http://localhost:5173/settings/provider')).toBe(
      '/settings/provider',
    );
  });

  it('strips the lng query param but keeps the rest', () => {
    expect(extractRestoreRoute('app://renderer/agent?lng=zh-CN&x=1')).toBe('/agent?x=1');
  });

  it('strips a lone lng query param', () => {
    expect(extractRestoreRoute('app://renderer/chat?lng=en-US')).toBe('/chat');
  });

  it('returns null for the root route', () => {
    expect(extractRestoreRoute('app://renderer/')).toBeNull();
  });

  it('returns null for file: protocol (splash/error pages)', () => {
    expect(extractRestoreRoute('file:///Users/x/resources/splash.html')).toBeNull();
  });

  it('returns null for static asset paths', () => {
    expect(extractRestoreRoute('app://renderer/assets/index.js')).toBeNull();
  });

  it('returns null for root static files', () => {
    expect(extractRestoreRoute('app://renderer/favicon.ico')).toBeNull();
  });

  it('preserves dotted SPA route slugs', () => {
    expect(extractRestoreRoute('app://renderer/community/skill/github.owner.repo')).toBe(
      '/community/skill/github.owner.repo',
    );
  });

  it('returns null for an unparseable URL', () => {
    expect(extractRestoreRoute('not a url')).toBeNull();
  });
});

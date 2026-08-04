import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSystemLanguage, resolveUILocale } from '../system-language';

const mockApp = vi.mocked(app);

describe('getSystemLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the OS language rather than the app locale', () => {
    mockApp.getPreferredSystemLanguages.mockReturnValue(['zh-Hans-CN']);
    // What a packaged build reports once `electronLanguages` prunes the locales
    mockApp.getLocale.mockReturnValue('en-US');

    expect(getSystemLanguage()).toBe('zh-CN');
  });

  it('falls back to the app locale when the OS reports nothing', () => {
    mockApp.getPreferredSystemLanguages.mockReturnValue([]);
    mockApp.getLocale.mockReturnValue('ja-JP');

    expect(getSystemLanguage()).toBe('ja-JP');
  });
});

describe('resolveUILocale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.getPreferredSystemLanguages.mockReturnValue(['zh-Hans-CN']);
    mockApp.getLocale.mockReturnValue('en-US');
  });

  it('keeps an explicit user choice untouched', () => {
    expect(resolveUILocale('ja-JP')).toBe('ja-JP');
  });

  it.each([undefined, 'auto'])('resolves %s to the OS language', (stored) => {
    expect(resolveUILocale(stored)).toBe('zh-CN');
  });
});

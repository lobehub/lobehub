import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRERENDER_LOCALE,
  documentPathFor,
  PRERENDER_LOCALES,
  PRERENDER_ROUTES,
  resolveDocumentLocale,
  SPA_FALLBACK_DOCUMENT,
} from './prerender';

describe('documentPathFor', () => {
  it('serves the default-locale document at the canonical path', () => {
    expect(documentPathFor('/signin', DEFAULT_PRERENDER_LOCALE)).toBe('/signin/index.html');
  });

  it('serves other locales from the folded i18n tree', () => {
    expect(documentPathFor('/signup', 'zh-CN')).toBe('/__i18n/zh-CN/signup/index.html');
  });

  it('falls back to the SPA shell for param routes', () => {
    expect(documentPathFor('/oauth/consent/abc', 'ja-JP')).toBe(SPA_FALLBACK_DOCUMENT);
  });
});

describe('resolveDocumentLocale', () => {
  it('keeps a prerendered locale', () => {
    expect(resolveDocumentLocale('ja-JP')).toBe('ja-JP');
  });

  it('falls back to the default locale when the request is unknown', () => {
    expect(resolveDocumentLocale('klingon')).toBe(DEFAULT_PRERENDER_LOCALE);
  });
});

describe('prerender matrix', () => {
  it('prerenders the four static auth routes', () => {
    expect([...PRERENDER_ROUTES]).toEqual([
      '/signin',
      '/signup',
      '/verify-email',
      '/reset-password',
    ]);
  });

  it('covers every locale that ships auth dictionaries', () => {
    expect(PRERENDER_LOCALES).toHaveLength(18);
    expect(PRERENDER_LOCALES).toContain(DEFAULT_PRERENDER_LOCALE);
  });
});

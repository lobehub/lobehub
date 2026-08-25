import { describe, expect, it } from 'vitest';

import { resolveRequestLocale } from './requestLocale';

const request = ({
  cookie,
  language,
  url,
}: { cookie?: string; language?: string; url?: string } = {}) => {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (language) headers.set('accept-language', language);

  return new Request(url ?? 'https://lobehub.com/share/t/abc', { headers });
};

describe('resolveRequestLocale', () => {
  it('prefers the hl query over the cookie and the browser', () => {
    expect(
      resolveRequestLocale(
        request({
          cookie: 'LOBE_LOCALE=ja-JP',
          language: 'ko-KR',
          url: 'https://lobehub.com/share/t/abc?hl=zh-CN',
        }),
      ),
    ).toBe('zh-CN');
  });

  it('prefers the cookie over the browser', () => {
    expect(resolveRequestLocale(request({ cookie: 'LOBE_LOCALE=ja-JP', language: 'ko-KR' }))).toBe(
      'ja-JP',
    );
  });

  it('reads the cookie among other cookies and decodes it', () => {
    expect(
      resolveRequestLocale(request({ cookie: 'foo=1; LOBE_LOCALE=zh-CN; NEXT_LOCALE=en' })),
    ).toBe('zh-CN');
    expect(resolveRequestLocale(request({ cookie: 'LOBE_LOCALE=zh%2DCN' }))).toBe('zh-CN');
  });

  it('survives a cookie with a malformed percent-escape', () => {
    expect(resolveRequestLocale(request({ cookie: 'LOBE_LOCALE=%E0%A4%A' }))).toBe('en-US');
  });

  it('honours Accept-Language quality weights over header order', () => {
    expect(resolveRequestLocale(request({ language: 'zh-CN;q=0.2,en-US;q=0.9' }))).toBe('en-US');
    expect(resolveRequestLocale(request({ language: 'en-US;q=0.2,zh-CN;q=0.9' }))).toBe('zh-CN');
  });

  it('keeps header order when no weights are given', () => {
    expect(resolveRequestLocale(request({ language: 'ja-JP,en-US' }))).toBe('ja-JP');
  });

  it('skips wildcards and unsupported tags to reach a supported one', () => {
    expect(resolveRequestLocale(request({ language: '*,xx-YY;q=0.9,ja-JP;q=0.8' }))).toBe('ja-JP');
  });

  it('matches Accept-Language case-insensitively', () => {
    expect(resolveRequestLocale(request({ language: 'zh-cn' }))).toBe('zh-CN');
    expect(resolveRequestLocale(request({ language: 'zh-Hans-CN' }))).toBe('zh-CN');
    expect(resolveRequestLocale(request({ language: 'zh-Hant-TW' }))).toBe('zh-TW');
  });

  it('falls back to the default for an explicit locale that is not supported', () => {
    expect(
      resolveRequestLocale(
        request({ language: 'zh-CN', url: 'https://lobehub.com/share/t/abc?hl=klingon' }),
      ),
    ).toBe('en-US');
    expect(
      resolveRequestLocale(request({ cookie: 'LOBE_LOCALE=klingon', language: 'zh-CN' })),
    ).toBe('en-US');
  });

  it('defers to the browser when the explicit locale is auto', () => {
    expect(resolveRequestLocale(request({ cookie: 'LOBE_LOCALE=auto', language: 'ja-JP' }))).toBe(
      'ja-JP',
    );
    expect(
      resolveRequestLocale(
        request({ language: 'ja-JP', url: 'https://lobehub.com/share/t/abc?hl=auto' }),
      ),
    ).toBe('ja-JP');
  });

  it('falls back to the default with no locale signal at all', () => {
    expect(resolveRequestLocale(request())).toBe('en-US');
    expect(resolveRequestLocale(request({ language: '' }))).toBe('en-US');
  });
});

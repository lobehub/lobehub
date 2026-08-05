import { describe, expect, it } from 'vitest';

import {
  normalizeSystemLanguage,
  readSystemLanguageArg,
  SYSTEM_LANGUAGE_ARG_PREFIX,
} from './systemLanguage';

describe('normalizeSystemLanguage', () => {
  it.each([
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
  ])('maps the Chinese tag %s to %s', (input, expected) => {
    expect(normalizeSystemLanguage(input)).toBe(expected);
  });

  it.each([
    ['en-US', 'en-US'],
    ['en-SG', 'en-US'],
    ['fr-FR', 'fr-FR'],
    ['fr', 'fr-FR'],
    ['ja-JP', 'ja-JP'],
    ['pt-PT', 'pt-BR'],
    ['ar-EG', 'ar'],
    ['fa', 'fa-IR'],
    ['zh_CN', 'zh-CN'],
  ])('maps %s to the supported locale %s', (input, expected) => {
    expect(normalizeSystemLanguage(input)).toBe(expected);
  });

  it.each([undefined, '', 'xx-XX'])('falls back to en-US for %s', (input) => {
    expect(normalizeSystemLanguage(input)).toBe('en-US');
  });
});

describe('readSystemLanguageArg', () => {
  it('reads the language injected via additionalArguments', () => {
    expect(
      readSystemLanguageArg(['--some-flag', `${SYSTEM_LANGUAGE_ARG_PREFIX}zh-CN`, '--other']),
    ).toBe('zh-CN');
  });

  it('returns undefined when the argument is absent or empty', () => {
    expect(readSystemLanguageArg(['--some-flag'])).toBeUndefined();
    expect(readSystemLanguageArg([SYSTEM_LANGUAGE_ARG_PREFIX])).toBeUndefined();
  });
});

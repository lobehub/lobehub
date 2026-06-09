import { describe, expect, it } from 'vitest';

import { normalizeLocale } from './resources';

describe('normalizeLocale', () => {
  it('should return "en-US" when locale is undefined', () => {
    expect(normalizeLocale()).toBe('en-US');
  });

  it('should return "zh-CN" when locale is "zh-CN"', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
  });

  it('should return "zh-CN" when locale is "zh"', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
  });

  it('should return "de-DE" when locale is "de"', () => {
    expect(normalizeLocale('de')).toBe('de-DE');
  });

  it('should return "ru-RU" when locale is "ru"', () => {
    expect(normalizeLocale('ru')).toBe('ru-RU');
  });

  it('should return "ar" when locale is "ar-EG"', () => {
    expect(normalizeLocale('ar')).toBe('ar');
    expect(normalizeLocale('ar-EG')).toBe('ar');
  });

  it('should return "en-US" when locale is "en"', () => {
    expect(normalizeLocale('en')).toBe('en-US');
  });

  it('should return the input locale for other valid locales', () => {
    expect(normalizeLocale('fr-FR')).toBe('fr-FR');
    expect(normalizeLocale('ja-JP')).toBe('ja-JP');
    expect(normalizeLocale('ko-KR')).toBe('ko-KR');
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
    expect(normalizeLocale('tr-TR')).toBe('tr-TR');
    expect(normalizeLocale('vi-VN')).toBe('vi-VN');
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
  });

  it('should return the input locale for unknown locales', () => {
    expect(normalizeLocale('unknown')).toBe('en-US');
    expect(normalizeLocale('fr')).toBe('fr-FR');
  });
});

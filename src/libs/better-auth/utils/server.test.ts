import { describe, expect, it } from 'vitest';

import { parseSSOProviders } from './server';

describe('parseSSOProviders', () => {
  it('should return empty array when input is undefined', () => {
    expect(parseSSOProviders(undefined)).toEqual([]);
  });

  it('should return empty array when input is empty string', () => {
    expect(parseSSOProviders('')).toEqual([]);
  });

  it('should return empty array when input contains only whitespace', () => {
    expect(parseSSOProviders('   ')).toEqual([]);
  });

  it('should parse single provider', () => {
    expect(parseSSOProviders('google')).toEqual(['google']);
  });

  it('should parse multiple providers separated by English comma', () => {
    expect(parseSSOProviders('google,github,microsoft')).toEqual(['google', 'github', 'microsoft']);
  });

  it('should parse multiple providers separated by Chinese comma', () => {
    expect(parseSSOProviders('google，github，microsoft')).toEqual([
      'google',
      'github',
      'microsoft',
    ]);
  });

  it('should parse providers with mixed comma separators', () => {
    expect(parseSSOProviders('google,github，microsoft')).toEqual([
      'google',
      'github',
      'microsoft',
    ]);
  });

  it('should trim whitespace from providers', () => {
    expect(parseSSOProviders(' google , github , microsoft ')).toEqual([
      'google',
      'github',
      'microsoft',
    ]);
  });

  it('should filter out empty entries', () => {
    expect(parseSSOProviders('google,,github,，,microsoft')).toEqual([
      'google',
      'github',
      'microsoft',
    ]);
  });

  it('should trim leading and trailing whitespace from input', () => {
    expect(parseSSOProviders('  google,github  ')).toEqual(['google', 'github']);
  });
});

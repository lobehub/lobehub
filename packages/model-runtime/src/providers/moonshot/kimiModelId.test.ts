import { describe, expect, it } from 'vitest';

import {
  isKimiAlwaysPreserveThinkingModel,
  isKimiNativeThinkingModel,
  isKimiPreserveThinkingModel,
  isKimiThinkingToggleModel,
  parseKimiModelId,
} from './kimiModelId';

describe('parseKimiModelId', () => {
  it('should parse Kimi K2 minor-version ids', () => {
    expect(parseKimiModelId('kimi-k2.6')).toEqual({
      family: 'k',
      majorVersion: 2,
      minorVersion: 6,
      normalizedModelId: 'kimi-k2.6',
      source: 'moonshot',
    });
  });

  it('should parse Kimi K2 variant ids', () => {
    expect(parseKimiModelId('kimi-k2.7-code')).toEqual({
      family: 'k',
      majorVersion: 2,
      minorVersion: 7,
      normalizedModelId: 'kimi-k2.7-code',
      source: 'moonshot',
      variant: 'code',
    });

    expect(parseKimiModelId('kimi-k2-thinking-turbo')).toEqual({
      family: 'k',
      majorVersion: 2,
      normalizedModelId: 'kimi-k2-thinking-turbo',
      source: 'moonshot',
      variant: 'thinking-turbo',
    });
  });

  it('should parse OpenRouter Kimi ids', () => {
    expect(parseKimiModelId('moonshotai/kimi-k2.7-code')).toEqual({
      family: 'k',
      majorVersion: 2,
      minorVersion: 7,
      normalizedModelId: 'kimi-k2.7-code',
      source: 'openRouter',
      variant: 'code',
    });
  });

  it('should return undefined for non-Kimi ids', () => {
    expect(parseKimiModelId('claude-sonnet-4-5')).toBeUndefined();
  });
});

describe('isKimiThinkingToggleModel', () => {
  it('should return true for Kimi K2 models with switchable thinking', () => {
    expect(isKimiThinkingToggleModel('kimi-k2.5')).toBe(true);
    expect(isKimiThinkingToggleModel('kimi-k2.6')).toBe(true);
  });

  it('should return false for always-thinking and legacy Kimi K2 ids', () => {
    expect(isKimiThinkingToggleModel('kimi-k2.7-code')).toBe(false);
    expect(isKimiThinkingToggleModel('kimi-k2-thinking')).toBe(false);
    expect(isKimiThinkingToggleModel('kimi-k2-turbo-preview')).toBe(false);
  });
});

describe('isKimiNativeThinkingModel', () => {
  it('should return true for native thinking Kimi models', () => {
    expect(isKimiNativeThinkingModel('kimi-k2-thinking')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k2-thinking-turbo')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k2.7-code')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k2.8-code')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k2.8-code-preview')).toBe(true);
  });

  it('should return false for switchable Kimi K2 models', () => {
    expect(isKimiNativeThinkingModel('kimi-k2.5')).toBe(false);
    expect(isKimiNativeThinkingModel('kimi-k2.6')).toBe(false);
  });
});

describe('isKimiAlwaysPreserveThinkingModel', () => {
  it('should return true for Kimi K2.7+ code models', () => {
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.7-code')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.7-code-highspeed')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.8-code-preview')).toBe(true);
  });

  it('should return false for switchable and non-code Kimi models', () => {
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.6')).toBe(false);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2-thinking')).toBe(false);
  });
});

describe('isKimiPreserveThinkingModel', () => {
  it('should return true for Kimi K2.6 models', () => {
    expect(isKimiPreserveThinkingModel('kimi-k2.6')).toBe(true);
  });

  it('should return false for other Kimi models', () => {
    expect(isKimiPreserveThinkingModel('kimi-k2.5')).toBe(false);
    expect(isKimiPreserveThinkingModel('kimi-k2.7-code')).toBe(false);
    expect(isKimiPreserveThinkingModel('kimi-k2-thinking')).toBe(false);
  });
});

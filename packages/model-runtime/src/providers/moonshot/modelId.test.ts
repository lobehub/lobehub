import { describe, expect, it } from 'vitest';

import {
  isKimiAlwaysPreserveThinkingModel,
  isKimiNativeThinkingModel,
  isKimiPreserveThinkingModel,
  isKimiReasoningEffortModel,
  isKimiReasoningModel,
  isKimiThinkingToggleModel,
  parseKimiModelId,
} from './modelId';

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

  it('should parse Kimi K3 generation ids', () => {
    expect(parseKimiModelId('kimi-k3')).toEqual({
      family: 'k',
      majorVersion: 3,
      normalizedModelId: 'kimi-k3',
      source: 'moonshot',
    });

    expect(parseKimiModelId('kimi-k3.1')).toEqual({
      family: 'k',
      majorVersion: 3,
      minorVersion: 1,
      normalizedModelId: 'kimi-k3.1',
      source: 'moonshot',
    });

    expect(parseKimiModelId('kimi-k3-code')).toEqual({
      family: 'k',
      majorVersion: 3,
      normalizedModelId: 'kimi-k3-code',
      source: 'moonshot',
      variant: 'code',
    });

    expect(parseKimiModelId('moonshotai/kimi-k3')).toEqual({
      family: 'k',
      majorVersion: 3,
      normalizedModelId: 'kimi-k3',
      source: 'openRouter',
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

  it('should return false for the whole Kimi K3 generation (native thinking, no toggle)', () => {
    expect(isKimiThinkingToggleModel('kimi-k3')).toBe(false);
    expect(isKimiThinkingToggleModel('kimi-k3.1')).toBe(false);
    expect(isKimiThinkingToggleModel('moonshotai/kimi-k3')).toBe(false);
    expect(isKimiThinkingToggleModel('kimi-k3-code')).toBe(false);
    expect(isKimiThinkingToggleModel('kimi-k3-thinking')).toBe(false);
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

  it('should treat Kimi K3 -code and -thinking variants as native thinking', () => {
    expect(isKimiNativeThinkingModel('kimi-k3-code')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k3-thinking')).toBe(true);
  });

  it('should return true for bare Kimi K3 generation ids (K3 always thinks)', () => {
    expect(isKimiNativeThinkingModel('kimi-k3')).toBe(true);
    expect(isKimiNativeThinkingModel('kimi-k3.1')).toBe(true);
    expect(isKimiNativeThinkingModel('moonshotai/kimi-k3')).toBe(true);
  });
});

describe('isKimiAlwaysPreserveThinkingModel', () => {
  it('should return true for Kimi K2.7+ code models', () => {
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.7-code')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.7-code-highspeed')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.8-code-preview')).toBe(true);
  });

  it('should return true for the whole Kimi K3 generation', () => {
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k3')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k3.1')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k3-code')).toBe(true);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k3-thinking')).toBe(true);
  });

  it('should return false for switchable and non-code Kimi K2 models', () => {
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2.6')).toBe(false);
    expect(isKimiAlwaysPreserveThinkingModel('kimi-k2-thinking')).toBe(false);
  });
});

describe('isKimiPreserveThinkingModel', () => {
  it('should return true for Kimi K2.6 models', () => {
    expect(isKimiPreserveThinkingModel('kimi-k2.6')).toBe(true);
  });

  it('should return false for the whole Kimi K3 generation (no thinking param at all)', () => {
    expect(isKimiPreserveThinkingModel('kimi-k3')).toBe(false);
    expect(isKimiPreserveThinkingModel('kimi-k3.1')).toBe(false);
    // K3 code always has Preserved Thinking active, so the param is redundant
    expect(isKimiPreserveThinkingModel('kimi-k3-code')).toBe(false);
  });

  it('should return false for other Kimi models', () => {
    expect(isKimiPreserveThinkingModel('kimi-k2.5')).toBe(false);
    expect(isKimiPreserveThinkingModel('kimi-k2.7-code')).toBe(false);
    expect(isKimiPreserveThinkingModel('kimi-k2-thinking')).toBe(false);
  });
});

describe('isKimiReasoningModel', () => {
  it('should return true for dot-versioned Kimi K2 models and later generations', () => {
    expect(isKimiReasoningModel('kimi-k2.5')).toBe(true);
    expect(isKimiReasoningModel('kimi-k2.6')).toBe(true);
    expect(isKimiReasoningModel('kimi-k2.7-code')).toBe(true);
    expect(isKimiReasoningModel('kimi-k3')).toBe(true);
    expect(isKimiReasoningModel('kimi-k3.1')).toBe(true);
    expect(isKimiReasoningModel('kimi-k3-code')).toBe(true);
    expect(isKimiReasoningModel('moonshotai/kimi-k3')).toBe(true);
  });

  it('should return false for legacy K2 ids without a minor version and non-Kimi models', () => {
    expect(isKimiReasoningModel('kimi-k2-0711-preview')).toBe(false);
    expect(isKimiReasoningModel('kimi-k2-thinking')).toBe(false);
    expect(isKimiReasoningModel('moonshot-v1-8k')).toBe(false);
  });
});

describe('isKimiReasoningEffortModel', () => {
  it('should return true for the whole Kimi K3 generation', () => {
    expect(isKimiReasoningEffortModel('kimi-k3')).toBe(true);
    expect(isKimiReasoningEffortModel('kimi-k3.1')).toBe(true);
    expect(isKimiReasoningEffortModel('kimi-k3-code')).toBe(true);
    expect(isKimiReasoningEffortModel('moonshotai/kimi-k3')).toBe(true);
  });

  it('should return false for Kimi K2 and legacy models', () => {
    expect(isKimiReasoningEffortModel('kimi-k2.6')).toBe(false);
    expect(isKimiReasoningEffortModel('kimi-k2.7-code')).toBe(false);
    expect(isKimiReasoningEffortModel('kimi-k2-thinking')).toBe(false);
    expect(isKimiReasoningEffortModel('moonshot-v1-8k')).toBe(false);
  });
});

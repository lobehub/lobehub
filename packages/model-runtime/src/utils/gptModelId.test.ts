import { describe, expect, it } from 'vitest';

import {
  isGPT5MinorAtLeast,
  isGPT5MinorVersion,
  isGPT5Model,
  isGPT5ProResponsesModel,
  isResponsesAPIModel,
  parseGPT5ModelId,
  resolveGPT5ReasoningExtendParam,
} from './gptModelId';

describe('parseGPT5ModelId', () => {
  it('should parse base GPT-5 ids', () => {
    expect(parseGPT5ModelId('gpt-5')).toEqual({
      majorVersion: 5,
      normalizedModelId: 'gpt-5',
    });
  });

  it('should parse minor GPT-5 ids', () => {
    expect(parseGPT5ModelId('gpt-5.6')).toEqual({
      majorVersion: 5,
      minorVersion: 6,
      normalizedModelId: 'gpt-5.6',
    });
  });

  it('should parse provider-prefixed GPT-5 ids', () => {
    expect(parseGPT5ModelId('openai/gpt-5.6-pro')).toEqual({
      majorVersion: 5,
      minorVersion: 6,
      normalizedModelId: 'gpt-5.6-pro',
      variant: 'pro',
    });
  });

  it('should parse dated GPT-5 pro ids', () => {
    expect(parseGPT5ModelId('gpt-5-pro-2025-10-06')).toEqual({
      majorVersion: 5,
      normalizedModelId: 'gpt-5-pro',
      variant: 'pro',
    });
  });

  it('should parse GPT-5 codex variants', () => {
    expect(parseGPT5ModelId('gpt-5.1-codex-mini')).toEqual({
      majorVersion: 5,
      minorVersion: 1,
      normalizedModelId: 'gpt-5.1-codex',
      variant: 'codex',
    });
  });

  it('should return undefined for non-GPT-5 ids', () => {
    expect(parseGPT5ModelId('gpt-4o')).toBeUndefined();
    expect(parseGPT5ModelId('not-gpt-5')).toBeUndefined();
  });
});

describe('GPT-5 model helpers', () => {
  it('should identify GPT-5 models', () => {
    expect(isGPT5Model('gpt-5-mini')).toBe(true);
    expect(isGPT5Model('openai/gpt-5.6')).toBe(true);
    expect(isGPT5Model('gpt-4o')).toBe(false);
  });

  it('should compare GPT-5 minor versions', () => {
    expect(isGPT5MinorAtLeast('gpt-5.6', 2)).toBe(true);
    expect(isGPT5MinorAtLeast('openai/gpt-5.1-mini', 2)).toBe(false);
    expect(isGPT5MinorAtLeast('gpt-5-mini', 1)).toBe(false);
    expect(isGPT5MinorVersion('gpt-5.1-codex', 1)).toBe(true);
  });

  it('should identify GPT-5 pro Responses models', () => {
    expect(isGPT5ProResponsesModel('gpt-5-pro')).toBe(true);
    expect(isGPT5ProResponsesModel('gpt-5.6-pro')).toBe(true);
    expect(isGPT5ProResponsesModel('openai/gpt-5.6-pro')).toBe(true);
    expect(isGPT5ProResponsesModel('gpt-5.6')).toBe(false);
  });

  it('should identify exact and future Responses API models', () => {
    expect(isResponsesAPIModel('gpt-5.5')).toBe(true);
    expect(isResponsesAPIModel('gpt-5.6')).toBe(true);
    expect(isResponsesAPIModel('openai/gpt-5.6')).toBe(true);
    expect(isResponsesAPIModel('gpt-5.1')).toBe(false);
    expect(isResponsesAPIModel('gpt-5-mini')).toBe(false);
    expect(isResponsesAPIModel('gpt-4o')).toBe(false);
  });

  it('should resolve GPT-5 reasoning extend params by minor version', () => {
    expect(resolveGPT5ReasoningExtendParam('gpt-5-mini')).toBe('gpt5ReasoningEffort');
    expect(resolveGPT5ReasoningExtendParam('openai/gpt-5.1-mini')).toBe('gpt5_1ReasoningEffort');
    expect(resolveGPT5ReasoningExtendParam('openai/gpt-5.2-mini')).toBe('gpt5_2ReasoningEffort');
    expect(resolveGPT5ReasoningExtendParam('openai/gpt-5.6')).toBe('gpt5_2ReasoningEffort');
    expect(resolveGPT5ReasoningExtendParam('gpt-4o')).toBeUndefined();
  });
});

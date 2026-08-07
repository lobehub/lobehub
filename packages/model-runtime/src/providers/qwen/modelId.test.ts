// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isThinkingForcedQwenModel, parseQwenModelId } from './modelId';

describe('parseQwenModelId', () => {
  it('should parse versioned commercial ids', () => {
    expect(parseQwenModelId('qwen3.8-max-preview')).toEqual({
      family: 'max',
      majorVersion: 3,
      minorVersion: 8,
      normalizedModelId: 'qwen3.8-max-preview',
    });

    expect(parseQwenModelId('qwen3-vl-plus')).toEqual({
      family: 'vl',
      majorVersion: 3,
      normalizedModelId: 'qwen3-vl-plus',
    });
  });

  it('should parse version-less commercial ids', () => {
    expect(parseQwenModelId('qwen-max')).toEqual({
      family: 'max',
      normalizedModelId: 'qwen-max',
    });

    expect(parseQwenModelId('qwen-plus-latest')).toEqual({
      family: 'plus',
      normalizedModelId: 'qwen-plus-latest',
    });
  });

  it('should normalize casing and whitespace', () => {
    expect(parseQwenModelId(' Qwen3.8-Max ')).toEqual({
      family: 'max',
      majorVersion: 3,
      minorVersion: 8,
      normalizedModelId: 'qwen3.8-max',
    });
  });

  it('should not treat open-source size segments as a family', () => {
    expect(parseQwenModelId('qwen3-235b-a22b-thinking-2507')).toBeUndefined();
    expect(parseQwenModelId('qwen2.5-72b-instruct')).toBeUndefined();
  });

  it('should return undefined for non-qwen ids', () => {
    expect(parseQwenModelId('deepseek-v4-pro')).toBeUndefined();
    expect(parseQwenModelId('')).toBeUndefined();
  });
});

describe('isThinkingForcedQwenModel', () => {
  it('should force thinking for qwen-max from 3.8 onwards', () => {
    expect(isThinkingForcedQwenModel('qwen3.8-max')).toBe(true);
    expect(isThinkingForcedQwenModel('qwen3.8-max-preview')).toBe(true);
    expect(isThinkingForcedQwenModel('qwen3.9-max')).toBe(true);
    expect(isThinkingForcedQwenModel('qwen4-max')).toBe(true);
  });

  it('should not force thinking for earlier or version-less max models', () => {
    expect(isThinkingForcedQwenModel('qwen3.7-max')).toBe(false);
    expect(isThinkingForcedQwenModel('qwen3-max')).toBe(false);
    expect(isThinkingForcedQwenModel('qwen-max')).toBe(false);
  });

  it('should not force thinking for other families', () => {
    expect(isThinkingForcedQwenModel('qwen3.8-plus')).toBe(false);
    expect(isThinkingForcedQwenModel('qwen3-vl-plus')).toBe(false);
    expect(isThinkingForcedQwenModel('deepseek-v4-pro')).toBe(false);
  });
});

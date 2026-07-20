import { describe, expect, it } from 'vitest';

import { isToolStreamSupportedGLMModel, parseGLMModelId } from './modelId';

describe('parseGLMModelId', () => {
  it('should parse base GLM ids', () => {
    expect(parseGLMModelId('glm-5')).toEqual({
      majorVersion: 5,
      normalizedModelId: 'glm-5',
    });
  });

  it('should parse minor-version GLM ids', () => {
    expect(parseGLMModelId('glm-5.2')).toEqual({
      majorVersion: 5,
      minorVersion: 2,
      normalizedModelId: 'glm-5.2',
    });
  });

  it('should normalize whitespace and case', () => {
    expect(parseGLMModelId(' GLM-5.3 ')).toEqual({
      majorVersion: 5,
      minorVersion: 3,
      normalizedModelId: 'glm-5.3',
    });
  });

  it('should return undefined for non-base GLM ids', () => {
    expect(parseGLMModelId('glm-5-turbo')).toBeUndefined();
    expect(parseGLMModelId('glm-5v-turbo')).toBeUndefined();
    expect(parseGLMModelId('glm-4.7-flash')).toBeUndefined();
    expect(parseGLMModelId('gpt-5')).toBeUndefined();
  });
});

describe('isToolStreamSupportedGLMModel', () => {
  it('should support current tool_stream GLM families', () => {
    expect(isToolStreamSupportedGLMModel('glm-4.6')).toBe(true);
    expect(isToolStreamSupportedGLMModel('glm-4.7')).toBe(true);
    expect(isToolStreamSupportedGLMModel('glm-5')).toBe(true);
    expect(isToolStreamSupportedGLMModel('glm-5.1')).toBe(true);
    expect(isToolStreamSupportedGLMModel('glm-5.2')).toBe(true);
  });

  it('should support future mainline GLM versions without new allowlist entries', () => {
    expect(isToolStreamSupportedGLMModel('glm-5.3')).toBe(true);
    expect(isToolStreamSupportedGLMModel('glm-6')).toBe(true);
  });

  it('should preserve unsupported GLM ids', () => {
    expect(isToolStreamSupportedGLMModel('glm-4')).toBe(false);
    expect(isToolStreamSupportedGLMModel('glm-4.5')).toBe(false);
    expect(isToolStreamSupportedGLMModel('glm-5-turbo')).toBe(false);
    expect(isToolStreamSupportedGLMModel('glm-5v-turbo')).toBe(false);
  });
});

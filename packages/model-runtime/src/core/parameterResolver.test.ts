import { describe, expect, it } from 'vitest';

import { hasTemperatureTopPConflict, shouldOmitSamplingParams } from '../const/models';
import {
  createParameterResolver,
  resolveModelSamplingParameters,
  resolveParameters,
} from './parameterResolver';

describe('resolveParameters', () => {
  describe('Basic functionality', () => {
    it('should return empty object when no parameters are provided', () => {
      const result = resolveParameters({}, {});
      expect(result).toEqual({});
    });

    it('should normalize temperature by dividing by 2 by default', () => {
      const result = resolveParameters({ temperature: 1 }, {});
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should not normalize temperature when normalizeTemperature is false', () => {
      const result = resolveParameters({ temperature: 1 }, { normalizeTemperature: false });
      expect(result).toEqual({ temperature: 1 });
    });

    it('should pass through top_p unchanged', () => {
      const result = resolveParameters({ top_p: 0.9 }, {});
      expect(result).toEqual({ top_p: 0.9 });
    });

    it('should return both parameters when no conflict', () => {
      const result = resolveParameters({ temperature: 1, top_p: 0.9 }, { hasConflict: false });
      expect(result).toEqual({ temperature: 0.5, top_p: 0.9 });
    });
  });

  describe('Conflict handling', () => {
    it('should prefer temperature over top_p when hasConflict is true', () => {
      const result = resolveParameters(
        { temperature: 1, top_p: 0.9 },
        { hasConflict: true, preferTemperature: true },
      );
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should prefer top_p over temperature when preferTemperature is false', () => {
      const result = resolveParameters(
        { temperature: 1, top_p: 0.9 },
        { hasConflict: true, preferTemperature: false },
      );
      expect(result).toEqual({ top_p: 0.9 });
    });

    it('should return temperature when only temperature is provided with conflict', () => {
      const result = resolveParameters({ temperature: 1 }, { hasConflict: true });
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should return top_p when only top_p is provided with conflict', () => {
      const result = resolveParameters({ top_p: 0.9 }, { hasConflict: true });
      expect(result).toEqual({ top_p: 0.9 });
    });
  });

  describe('Range constraints', () => {
    it('should apply temperature min constraint', () => {
      const result = resolveParameters(
        { temperature: 0.02 }, // 0.02 / 2 = 0.01
        { temperatureRange: { min: 0.05 } },
      );
      expect(result).toEqual({ temperature: 0.05 });
    });

    it('should apply temperature max constraint', () => {
      const result = resolveParameters(
        { temperature: 2 }, // 2 / 2 = 1
        { temperatureRange: { max: 0.99 } },
      );
      expect(result).toEqual({ temperature: 0.99 });
    });

    it('should apply top_p min constraint', () => {
      const result = resolveParameters({ top_p: 0.005 }, { topPRange: { min: 0.01 } });
      expect(result).toEqual({ top_p: 0.01 });
    });

    it('should apply top_p max constraint', () => {
      const result = resolveParameters({ top_p: 1.5 }, { topPRange: { max: 0.99 } });
      expect(result).toEqual({ top_p: 0.99 });
    });

    it('should apply both min and max constraints', () => {
      const result = resolveParameters(
        { temperature: 0.02, top_p: 0.005 },
        {
          temperatureRange: { max: 0.99, min: 0.01 },
          topPRange: { max: 0.99, min: 0.01 },
        },
      );
      expect(result).toEqual({ temperature: 0.01, top_p: 0.01 });
    });
  });

  describe('Additional parameters', () => {
    it('should handle frequency_penalty', () => {
      const result = resolveParameters({ frequency_penalty: 0.5 }, {});
      expect(result).toEqual({ frequency_penalty: 0.5 });
    });

    it('should handle presence_penalty', () => {
      const result = resolveParameters({ presence_penalty: 0.5 }, {});
      expect(result).toEqual({ presence_penalty: 0.5 });
    });

    it('should handle max_tokens', () => {
      const result = resolveParameters({ max_tokens: 1000 }, {});
      expect(result).toEqual({ max_tokens: 1000 });
    });

    it('should apply frequency_penalty range constraints', () => {
      const result = resolveParameters(
        { frequency_penalty: 3 },
        { frequencyPenaltyRange: { max: 2, min: -2 } },
      );
      expect(result).toEqual({ frequency_penalty: 2 });
    });

    it('should apply presence_penalty range constraints', () => {
      const result = resolveParameters(
        { presence_penalty: -3 },
        { presencePenaltyRange: { max: 2, min: -2 } },
      );
      expect(result).toEqual({ presence_penalty: -2 });
    });

    it('should apply max_tokens range constraints', () => {
      const result = resolveParameters({ max_tokens: 100_000 }, { maxTokensRange: { max: 8192 } });
      expect(result).toEqual({ max_tokens: 8192 });
    });

    it('should handle all parameters together', () => {
      const result = resolveParameters(
        {
          frequency_penalty: 0.5,
          max_tokens: 2000,
          presence_penalty: 0.5,
          temperature: 1,
          top_p: 0.9,
        },
        {},
      );
      expect(result).toEqual({
        frequency_penalty: 0.5,
        max_tokens: 2000,
        presence_penalty: 0.5,
        temperature: 0.5,
        top_p: 0.9,
      });
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle Claude Opus 4.1 scenario (conflict with normalization)', () => {
      const result = resolveParameters(
        { temperature: 1, top_p: 0.9 },
        { hasConflict: true, normalizeTemperature: true, preferTemperature: true },
      );
      expect(result).toEqual({ temperature: 0.5 });
    });

    it('should handle Zhipu glm-4-alltools scenario (range constraints)', () => {
      const result = resolveParameters(
        { temperature: 1, top_p: 0.5 },
        {
          normalizeTemperature: true,
          temperatureRange: { max: 0.99, min: 0.01 },
          topPRange: { max: 0.99, min: 0.01 },
        },
      );
      expect(result).toEqual({ temperature: 0.5, top_p: 0.5 });
    });

    it('should handle Groq scenario (temperature <= 0 becomes undefined)', () => {
      // In Groq's case, they handle this in their own logic, but we can test the parameter resolver
      const result = resolveParameters({ temperature: 0 }, { normalizeTemperature: false });
      expect(result.temperature).toBe(0);
    });

    it('should handle Qwen range constraint scenario with multiple parameters', () => {
      const result = resolveParameters(
        { presence_penalty: 1.5, temperature: 1.5, top_p: 0.8 },
        {
          normalizeTemperature: false,
          presencePenaltyRange: { max: 2, min: -2 },
          temperatureRange: { max: 2, min: 0 },
          topPRange: { max: 1, min: 0 },
        },
      );
      expect(result).toEqual({ presence_penalty: 1.5, temperature: 1.5, top_p: 0.8 });
    });
  });

  describe('Edge cases', () => {
    it('should handle temperature = 0', () => {
      const result = resolveParameters({ temperature: 0 }, {});
      expect(result).toEqual({ temperature: 0 });
    });

    it('should handle top_p = 0', () => {
      const result = resolveParameters({ top_p: 0 }, {});
      expect(result).toEqual({ top_p: 0 });
    });

    it('should handle temperature = undefined explicitly', () => {
      const result = resolveParameters({ temperature: undefined, top_p: 0.9 }, {});
      expect(result).toEqual({ top_p: 0.9 });
    });

    it('should treat null values as undefined', () => {
      const result = resolveParameters(
        { frequency_penalty: null, temperature: null, top_p: 0.9 },
        {},
      );
      expect(result).toEqual({ top_p: 0.9 });
    });

    it('should handle both parameters undefined with conflict', () => {
      const result = resolveParameters({}, { hasConflict: true });
      expect(result).toEqual({});
    });
  });
});

describe('resolveModelSamplingParameters', () => {
  it('should omit top_p for Claude 4+ models when temperature is also set', () => {
    const result = resolveModelSamplingParameters(
      'claude-haiku-4-5-20251001',
      { temperature: 0.7, top_p: 0.9 },
      { normalizeTemperature: false, preferTemperature: true },
    );

    // Always returns both keys so spreading onto a payload clears the conflicting field
    expect(result).toEqual({ temperature: 0.7, top_p: undefined });
  });

  it('should keep both parameters for non-conflict models', () => {
    const result = resolveModelSamplingParameters(
      'claude-3-5-sonnet-20240620',
      { temperature: 0.7, top_p: 0.9 },
      { normalizeTemperature: false, preferTemperature: true },
    );

    expect(result).toEqual({ temperature: 0.7, top_p: 0.9 });
  });

  it('should treat null sampling values as undefined and not include them in result', () => {
    const result = resolveModelSamplingParameters(
      'claude-haiku-4-5-20251001',
      { temperature: null, top_p: 0.9 },
      { normalizeTemperature: false, preferTemperature: true },
    );

    // temperature was null (treated as not provided), so it should not appear in result
    expect(result).toEqual({ top_p: 0.9 });
    expect(result).not.toHaveProperty('temperature');
  });

  it('should not add spurious undefined keys when input omits fields', () => {
    const result = resolveModelSamplingParameters(
      'gpt-4o',
      {},
      { normalizeTemperature: false, preferTemperature: true },
    );

    expect(result).toEqual({});
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
  });

  it('should omit temperature and top_p for models that reject sampling params', () => {
    const result = resolveModelSamplingParameters(
      'claude-opus-4-7',
      { temperature: 0.7, top_p: 0.9 },
      { normalizeTemperature: false, preferTemperature: true },
    );

    // Both keys present with undefined values so spreading clears any pre-set payload fields
    expect(result).toEqual({ temperature: undefined, top_p: undefined });
  });

  it('should omit temperature and top_p for Bedrock Opus 4.7 id', () => {
    const result = resolveModelSamplingParameters(
      'us.anthropic.claude-opus-4-7-v1',
      { temperature: 0.7, top_p: 0.9 },
      { normalizeTemperature: false, preferTemperature: true },
    );

    expect(result).toEqual({ temperature: undefined, top_p: undefined });
  });

  it('should not add spurious keys when omit-model input has no sampling fields', () => {
    const result = resolveModelSamplingParameters(
      'claude-opus-4-7',
      {},
      { normalizeTemperature: false, preferTemperature: true },
    );

    expect(result).toEqual({});
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('top_p');
  });
});

describe('createParameterResolver', () => {
  it('should create a resolver with predefined options', () => {
    const resolver = createParameterResolver({
      hasConflict: true,
      normalizeTemperature: true,
      preferTemperature: true,
    });

    const result = resolver({ temperature: 1, top_p: 0.9 });
    expect(result).toEqual({ temperature: 0.5 });
  });

  it('should create a resolver with range constraints', () => {
    const resolver = createParameterResolver({
      normalizeTemperature: true,
      temperatureRange: { max: 0.99, min: 0.01 },
      topPRange: { max: 0.99, min: 0.01 },
    });

    const result = resolver({ temperature: 0.02, top_p: 0.005 });
    expect(result).toEqual({ temperature: 0.01, top_p: 0.01 });
  });
});

describe('hasTemperatureTopPConflict', () => {
  describe('Anthropic Claude 4+ models', () => {
    it('should return true for Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('claude-opus-4-1-20250805')).toBe(true);
      expect(hasTemperatureTopPConflict('claude-sonnet-4-5-20250929')).toBe(true);
      expect(hasTemperatureTopPConflict('claude-haiku-4-5-20251001')).toBe(true);
    });

    it('should return false for Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('claude-3-opus-20240229')).toBe(false);
      expect(hasTemperatureTopPConflict('claude-3-5-sonnet-20240620')).toBe(false);
    });
  });

  describe('OpenRouter Claude 4+ models', () => {
    it('should return true for OpenRouter Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('anthropic/claude-opus-4.5')).toBe(true);
      expect(hasTemperatureTopPConflict('anthropic/claude-sonnet-4.1')).toBe(true);
      expect(hasTemperatureTopPConflict('anthropic/claude-4.5-opus')).toBe(true);
    });

    it('should return false for OpenRouter Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('anthropic/claude-3.5-sonnet')).toBe(false);
      expect(hasTemperatureTopPConflict('anthropic/claude-3.7-sonnet')).toBe(false);
    });
  });

  describe('Bedrock Claude 4+ models', () => {
    it('should return true for Bedrock Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('anthropic.claude-opus-4-1-20250805-v1:0')).toBe(true);
      expect(hasTemperatureTopPConflict('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    });

    it('should return false for Bedrock Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('anthropic.claude-3-5-sonnet-20240620-v1:0')).toBe(false);
    });
  });
});

describe('shouldOmitSamplingParams', () => {
  it('should return true for Claude Opus 4.7 (Anthropic API id)', () => {
    expect(shouldOmitSamplingParams('claude-opus-4-7')).toBe(true);
  });

  it('should return true for Claude Opus 4.7 on Bedrock (with and without region prefix)', () => {
    expect(shouldOmitSamplingParams('anthropic.claude-opus-4-7')).toBe(true);
    expect(shouldOmitSamplingParams('us.anthropic.claude-opus-4-7-v1')).toBe(true);
  });

  it('should return true for Claude Opus 4.7 on OpenRouter (dot notation)', () => {
    expect(shouldOmitSamplingParams('anthropic/claude-opus-4.7')).toBe(true);
    expect(shouldOmitSamplingParams('anthropic/claude-4.7-opus')).toBe(true);
  });

  it('should return false for hypothetical dash-form OpenRouter id', () => {
    // OpenRouter uses dot notation; dash form is not a real id and must not match
    // to avoid accidentally stripping params from unrelated future model ids.
    expect(shouldOmitSamplingParams('anthropic/claude-opus-4-7')).toBe(false);
  });

  it('should return false for Claude Opus 4.6 and earlier', () => {
    expect(shouldOmitSamplingParams('claude-opus-4-6')).toBe(false);
    expect(shouldOmitSamplingParams('claude-sonnet-4-5-20250929')).toBe(false);
    expect(shouldOmitSamplingParams('anthropic.claude-opus-4-6-v1')).toBe(false);
  });

  it('should return false for non-Claude models', () => {
    expect(shouldOmitSamplingParams('gpt-4o')).toBe(false);
    expect(shouldOmitSamplingParams('gemini-2.5-pro')).toBe(false);
  });
});

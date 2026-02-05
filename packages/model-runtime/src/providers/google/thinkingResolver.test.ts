import { describe, expect, it } from 'vitest';

import {
  getGoogleThinkingModelCategory,
  isGemini3Model,
  isThinkingEnabledModel,
  resolveGoogleThinkingBudget,
  resolveGoogleThinkingConfig,
} from './thinkingResolver';

describe('thinkingResolver', () => {
  describe('getGoogleThinkingModelCategory', () => {
    it('should return "other" for undefined model', () => {
      expect(getGoogleThinkingModelCategory(undefined)).toBe('other');
    });

    it('should return "other" for empty string', () => {
      expect(getGoogleThinkingModelCategory('')).toBe('other');
    });

    // Pro models
    describe('pro category', () => {
      it.each([
        'gemini-2.5-pro',
        'gemini-2.5-pro-preview',
        'gemini-3-pro',
        'gemini-3-pro-preview',
        'gemini-3.0-pro',
        'pro-latest',
      ])('should return "pro" for %s', (model) => {
        expect(getGoogleThinkingModelCategory(model)).toBe('pro');
      });
    });

    // Flash models
    describe('flash category', () => {
      it.each([
        'gemini-2.5-flash',
        'gemini-2.5-flash-preview',
        'gemini-3-flash',
        'gemini-3.0-flash',
        'flash-latest',
      ])('should return "flash" for %s', (model) => {
        expect(getGoogleThinkingModelCategory(model)).toBe('flash');
      });
    });

    // Flash Lite models
    describe('flashLite category', () => {
      it.each([
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-lite-preview',
        'gemini-3-flash-lite',
        'flash-lite-latest',
      ])('should return "flashLite" for %s', (model) => {
        expect(getGoogleThinkingModelCategory(model)).toBe('flashLite');
      });
    });

    // Robotics models
    describe('robotics category', () => {
      it('should return "robotics" for robotics-er-1.5-preview', () => {
        expect(getGoogleThinkingModelCategory('robotics-er-1.5-preview')).toBe('robotics');
      });
    });

    // Other models
    describe('other category', () => {
      it.each(['gemma-3-1b-it', 'unknown-model', 'custom-model'])(
        'should return "other" for %s',
        (model) => {
          expect(getGoogleThinkingModelCategory(model)).toBe('other');
        },
      );
    });
  });

  describe('isGemini3Model', () => {
    it('should return false for undefined', () => {
      expect(isGemini3Model(undefined)).toBe(false);
    });

    it.each([
      'gemini-3-pro',
      'gemini-3-pro-preview',
      'gemini-3-flash',
      'gemini-3.0-pro',
      'gemini-3.0-flash',
      'gemini-3-pro-image-preview',
    ])('should return true for %s', (model) => {
      expect(isGemini3Model(model)).toBe(true);
    });

    it.each(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemma-3-1b-it', 'pro-latest'])(
      'should return false for %s',
      (model) => {
        expect(isGemini3Model(model)).toBe(false);
      },
    );
  });

  describe('isThinkingEnabledModel', () => {
    it('should return false for undefined', () => {
      expect(isThinkingEnabledModel(undefined)).toBe(false);
    });

    it.each([
      // Gemini 3 Pro/Flash models
      'gemini-3-pro',
      'gemini-3-pro-preview',
      'gemini-3.0-pro',
      'gemini-3-flash',
      'gemini-3.0-flash',
      // Pro image models
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image',
      // Other thinking-enabled models
      'nano-banana-pro-preview',
      'nano-banana-pro',
      'gemini-thinking-preview',
      'some-thinking-model',
    ])('should return true for %s', (model) => {
      expect(isThinkingEnabledModel(model)).toBe(true);
    });

    it.each([
      'gemini-2.5-pro', // 2.5 Pro is also thinking-enabled
      'gemini-2.5-flash', // 2.5 Flash is also thinking-enabled
    ])('should return true for %s', (model) => {
      expect(isThinkingEnabledModel(model)).toBe(true);
    });

    it.each([
      'gemini-2.5-flash-lite', // flash-lite is NOT auto-enabled
      'gemma-3-1b-it',
    ])('should return false for %s', (model) => {
      expect(isThinkingEnabledModel(model)).toBe(false);
    });
  });

  describe('resolveGoogleThinkingBudget', () => {
    describe('pro models', () => {
      const model = 'gemini-3-pro-preview';

      it('should return -1 (dynamic) by default', () => {
        expect(resolveGoogleThinkingBudget(model, undefined)).toBe(-1);
        expect(resolveGoogleThinkingBudget(model, null)).toBe(-1);
      });

      it('should return -1 when explicitly set to -1', () => {
        expect(resolveGoogleThinkingBudget(model, -1)).toBe(-1);
      });

      it('should clamp to min (128)', () => {
        expect(resolveGoogleThinkingBudget(model, 50)).toBe(128);
        expect(resolveGoogleThinkingBudget(model, 0)).toBe(128);
      });

      it('should clamp to max (32768)', () => {
        expect(resolveGoogleThinkingBudget(model, 50000)).toBe(32_768);
      });

      it('should return value within range', () => {
        expect(resolveGoogleThinkingBudget(model, 5000)).toBe(5000);
      });
    });

    describe('flash models', () => {
      const model = 'gemini-2.5-flash';

      it('should return -1 (dynamic) by default', () => {
        expect(resolveGoogleThinkingBudget(model, undefined)).toBe(-1);
      });

      it('should allow 0 (disabled)', () => {
        expect(resolveGoogleThinkingBudget(model, 0)).toBe(0);
      });

      it('should allow -1 (dynamic)', () => {
        expect(resolveGoogleThinkingBudget(model, -1)).toBe(-1);
      });

      it('should clamp to max (24576)', () => {
        expect(resolveGoogleThinkingBudget(model, 30000)).toBe(24_576);
      });
    });

    describe('flashLite models', () => {
      const model = 'gemini-2.5-flash-lite';

      it('should return 0 (disabled) by default', () => {
        expect(resolveGoogleThinkingBudget(model, undefined)).toBe(0);
      });

      it('should allow 0 (disabled)', () => {
        expect(resolveGoogleThinkingBudget(model, 0)).toBe(0);
      });

      it('should allow -1 (dynamic)', () => {
        expect(resolveGoogleThinkingBudget(model, -1)).toBe(-1);
      });

      it('should clamp to min (512)', () => {
        expect(resolveGoogleThinkingBudget(model, 100)).toBe(512);
      });

      it('should clamp to max (24576)', () => {
        expect(resolveGoogleThinkingBudget(model, 30000)).toBe(24_576);
      });
    });

    describe('robotics models', () => {
      const model = 'robotics-er-1.5-preview';

      it('should return 0 (disabled) by default', () => {
        expect(resolveGoogleThinkingBudget(model, undefined)).toBe(0);
      });

      it('should clamp to min (512)', () => {
        expect(resolveGoogleThinkingBudget(model, 100)).toBe(512);
      });
    });

    describe('other models', () => {
      const model = 'unknown-model';

      it('should return undefined by default', () => {
        expect(resolveGoogleThinkingBudget(model, undefined)).toBeUndefined();
      });

      it('should clamp to flash max (24576) if provided', () => {
        expect(resolveGoogleThinkingBudget(model, 30000)).toBe(24_576);
      });
    });
  });

  describe('resolveGoogleThinkingConfig', () => {
    describe('gemini-3-pro-preview (the original issue model)', () => {
      const model = 'gemini-3-pro-preview';

      it('should not set thinkingBudget by default for Gemini 3 (let API decide)', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        // For Gemini 3 models, when neither thinkingLevel nor thinkingBudget is set,
        // don't set any thinking params - let API use its default behavior
        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
        });
      });

      it('should enable includeThoughts with thinkingLevel (without thinkingBudget - mutually exclusive)', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingLevel: 'high' });

        // thinkingLevel and thinkingBudget are mutually exclusive
        // When thinkingLevel is set, thinkingBudget should be undefined
        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
          thinkingLevel: 'high',
        });
      });

      it('should enable includeThoughts with thinkingBudget', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 5000 });

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: 5000,
        });
      });
    });

    describe('gemini-3-pro-image-preview (thinking-enabled model)', () => {
      const model = 'gemini-3-pro-image-preview';

      it('should not set thinkingBudget by default for Gemini 3 (let API decide)', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        // For Gemini 3 models, don't set thinkingBudget by default
        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
        });
      });
    });

    describe('gemini-2.5-pro (also thinking-enabled by default)', () => {
      const model = 'gemini-2.5-pro';

      it('should enable includeThoughts by default', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: -1,
        });
      });

      it('should enable includeThoughts with thinkingBudget', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 5000 });

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: 5000,
        });
      });

      it('should not include thinkingLevel for 2.5 models (only 3.0+ supports thinkingLevel)', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingLevel: 'high' });

        // thinkingLevel enables includeThoughts, but the level itself is not passed for 2.5
        expect(result.includeThoughts).toBe(true);
        expect(result.thinkingLevel).toBeUndefined();
      });
    });

    describe('gemini-2.5-flash (also thinking-enabled by default)', () => {
      const model = 'gemini-2.5-flash';

      it('should enable includeThoughts by default', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: -1,
        });
      });

      it('should enable includeThoughts with thinkingBudget', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 10000 });

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: 10000,
        });
      });

      it('should allow disabling thinking with budget 0', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 0 });

        expect(result).toEqual({
          includeThoughts: undefined,
          thinkingBudget: 0,
        });
      });
    });

    describe('gemini-3-flash (supports thinking and thinkingLevel)', () => {
      const model = 'gemini-3-flash';

      it('should not set thinkingBudget by default for Gemini 3 (let API decide)', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        // For Gemini 3 models, don't set thinkingBudget by default
        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
        });
      });

      it('should include thinkingLevel for 3.0 models (without thinkingBudget - mutually exclusive)', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingLevel: 'low' });

        // thinkingLevel and thinkingBudget are mutually exclusive
        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
          thinkingLevel: 'low',
        });
      });

      it('should prioritize thinkingLevel over thinkingBudget when both are provided (mutually exclusive)', () => {
        // When both thinkingBudget and thinkingLevel are provided,
        // thinkingLevel takes priority and thinkingBudget is ignored
        // because Gemini API requires them to be mutually exclusive
        const result = resolveGoogleThinkingConfig(model, {
          thinkingBudget: 8000,
          thinkingLevel: 'high',
        });

        expect(result).toEqual({
          includeThoughts: true,
          thinkingBudget: undefined,
          thinkingLevel: 'high',
        });
      });
    });

    describe('gemini-2.5-flash-lite', () => {
      const model = 'gemini-2.5-flash-lite';

      it('should return disabled by default', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        expect(result).toEqual({
          includeThoughts: undefined,
          thinkingBudget: 0,
        });
      });

      it('should not enable includeThoughts when budget is 0', () => {
        const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 0 });

        expect(result.includeThoughts).toBeUndefined();
      });
    });

    describe('nano-banana-pro-preview (thinking-enabled model)', () => {
      const model = 'nano-banana-pro-preview';

      it('should enable includeThoughts by default', () => {
        const result = resolveGoogleThinkingConfig(model, {});

        // nano-banana-pro is 'other' category, so thinkingBudget is undefined
        expect(result.includeThoughts).toBe(true);
      });
    });
  });
});

describe('resolveGoogleThinkingBudget', () => {
  it('returns dynamic defaults for 2.5 pro models', () => {
    expect(resolveGoogleThinkingBudget('gemini-2.5-pro')).toBe(-1);
  });

  it('clamps manual budgets for 2.5 pro models', () => {
    expect(resolveGoogleThinkingBudget('gemini-2.5-pro', 0)).toBe(128);
    expect(resolveGoogleThinkingBudget('gemini-2.5-pro', 40_000)).toBe(32_768);
  });

  it('supports disabling and dynamic thinking for flash models', () => {
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash')).toBe(-1);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash', 0)).toBe(0);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash', -1)).toBe(-1);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash', -5)).toBe(0);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash-preview', 30_000)).toBe(24_576);
  });

  it('enforces flash lite family defaults and ranges', () => {
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash-lite')).toBe(0);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash-lite', 400)).toBe(512);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash-lite', 600)).toBe(600);
    expect(resolveGoogleThinkingBudget('gemini-2.5-flash-lite-preview', 25_000)).toBe(24_576);
  });

  it('applies robotics preview defaults and overrides', () => {
    expect(resolveGoogleThinkingBudget('robotics-er-1.5-preview')).toBe(0);
    expect(resolveGoogleThinkingBudget('robotics-er-1.5-preview', -1)).toBe(-1);
    expect(resolveGoogleThinkingBudget('robotics-er-1.5-preview', 256)).toBe(512);
  });

  it('falls back to generic behaviour for other models', () => {
    expect(resolveGoogleThinkingBudget('unknown-model')).toBeUndefined();
    expect(resolveGoogleThinkingBudget('unknown-model', 999)).toBe(999);
    expect(resolveGoogleThinkingBudget('unknown-model', 99_999)).toBe(24_576);
  });
});

/**
 * Tests for mutual exclusivity of thinkingBudget and thinkingLevel
 *
 * Gemini API returns error if both are set:
 * "You can only set only one of thinking budget and thinking level."
 */
describe('thinkingBudget and thinkingLevel mutual exclusivity', () => {
  describe('Gemini 3.0+ models (supports thinkingLevel)', () => {
    const models = ['gemini-3-pro', 'gemini-3-flash', 'gemini-3.0-pro-preview'];

    it.each(models)('%s: should use thinkingLevel only when set', (model) => {
      const result = resolveGoogleThinkingConfig(model, { thinkingLevel: 'high' });

      expect(result.thinkingLevel).toBe('high');
      expect(result.thinkingBudget).toBeUndefined();
    });

    it.each(models)('%s: should use thinkingBudget when thinkingLevel is not set', (model) => {
      const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 5000 });

      expect(result.thinkingBudget).toBe(5000);
      expect(result.thinkingLevel).toBeUndefined();
    });

    it.each(models)('%s: should prioritize thinkingLevel when both are provided', (model) => {
      const result = resolveGoogleThinkingConfig(model, {
        thinkingBudget: 10000,
        thinkingLevel: 'low',
      });

      expect(result.thinkingLevel).toBe('low');
      expect(result.thinkingBudget).toBeUndefined();
    });

    it.each(models)(
      '%s: should not set thinkingBudget when neither is set (let API decide)',
      (model) => {
        const result = resolveGoogleThinkingConfig(model, {});

        // For Gemini 3 models, don't set any thinking params by default
        expect(result.thinkingBudget).toBeUndefined();
        expect(result.thinkingLevel).toBeUndefined();
      },
    );
  });

  describe('Gemini 2.x models (does not support thinkingLevel)', () => {
    const models = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-preview'];

    it.each(models)('%s: should always use thinkingBudget', (model) => {
      const result = resolveGoogleThinkingConfig(model, { thinkingBudget: 8000 });

      expect(result.thinkingBudget).toBe(8000);
      expect(result.thinkingLevel).toBeUndefined();
    });

    it.each(models)('%s: should ignore thinkingLevel (not supported)', (model) => {
      // Even if thinkingLevel is provided, it should be ignored for 2.x models
      const result = resolveGoogleThinkingConfig(model, { thinkingLevel: 'high' });

      // thinkingLevel is not supported, so it falls back to default budget
      expect(result.thinkingBudget).toBe(-1);
      expect(result.thinkingLevel).toBeUndefined();
    });

    it.each(models)(
      '%s: should use thinkingBudget when both are provided (thinkingLevel not supported)',
      (model) => {
        const result = resolveGoogleThinkingConfig(model, {
          thinkingBudget: 12000,
          thinkingLevel: 'low',
        });

        expect(result.thinkingBudget).toBe(12000);
        expect(result.thinkingLevel).toBeUndefined();
      },
    );
  });
});

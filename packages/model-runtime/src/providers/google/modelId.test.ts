import { describe, expect, it } from 'vitest';

import {
  isGemini3OrAbove,
  isGeminiVersionAtLeast,
  isGoogleImageResponseModel,
  isGoogleNanoBananaModel,
  isGoogleSafetyOffModel,
  normalizeGoogleModelId,
  parseGoogleModelId,
  shouldDisableGoogleSystemInstruction,
  shouldDisableGoogleThinkingConfig,
  shouldOmitDeprecatedGoogleGenerationParams,
  shouldUseGoogleImageSearchTypes,
  supportsGoogleSearchOnImageResponseModel,
} from './modelId';

describe('modelId', () => {
  describe('normalizeGoogleModelId', () => {
    it.each([
      ['gemini-3.5-pro', 'gemini-3.5-pro'],
      ['google/gemini-3.5-pro', 'gemini-3.5-pro'],
      ['models/gemini-3.5-pro', 'gemini-3.5-pro'],
      ['publishers/google/models/gemini-3.5-pro', 'gemini-3.5-pro'],
    ])('normalizes %s', (model, expected) => {
      expect(normalizeGoogleModelId(model)).toBe(expected);
    });
  });

  describe('parseGoogleModelId', () => {
    it('parses future Gemini 3.5 Pro ids without a hardcoded model list', () => {
      expect(parseGoogleModelId('gemini-3.5-pro-preview')).toMatchObject({
        family: 'gemini',
        majorVersion: 3,
        minorVersion: 5,
        modifiers: ['pro', 'preview'],
        normalizedModelId: 'gemini-3.5-pro-preview',
        source: 'google',
      });
    });

    it('preserves source for prefixed Google ids', () => {
      expect(parseGoogleModelId('google/gemini-3.5-pro')).toMatchObject({
        family: 'gemini',
        majorVersion: 3,
        minorVersion: 5,
        modifiers: ['pro'],
        normalizedModelId: 'gemini-3.5-pro',
        source: 'googlePrefixed',
      });
    });
  });

  describe('version helpers', () => {
    it.each(['gemini-3-pro', 'gemini-3.5-pro', 'google/gemini-3.5-pro'])(
      'detects Gemini 3+ for %s',
      (model) => {
        expect(isGemini3OrAbove(model)).toBe(true);
      },
    );

    it('compares minor versions', () => {
      expect(isGeminiVersionAtLeast('gemini-3.5-pro', 3, 5)).toBe(true);
      expect(isGeminiVersionAtLeast('gemini-3.1-pro', 3, 5)).toBe(false);
      expect(isGeminiVersionAtLeast('gemini-4-pro', 3, 5)).toBe(true);
    });

    it.each([
      ['gemini-3.5-flash', false],
      ['gemini-3.5-flash-lite', true],
      ['gemini-3.6-flash', true],
      ['google/gemini-4-flash', true],
    ])('detects modern generation config requirements for %s', (model, expected) => {
      expect(shouldOmitDeprecatedGoogleGenerationParams(model)).toBe(expected);
    });
  });

  describe('image response helpers', () => {
    it.each([
      'gemini-2.5-flash-image',
      'gemini-3.5-pro-image-preview',
      'google/gemini-3.5-pro-image-preview-free',
      'nano-banana-pro-preview',
      // Real Nano Banana model ids (Google): every one is an image-output model
      // and must request the Image response modality. `gemini-3.1-flash-lite-image`
      // (Nano Banana 2 Lite) is the id that surfaced the base64-as-text bug.
      'gemini-3.1-flash-lite-image',
      'gemini-3.1-flash-lite-image:image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      // Bare nanoBanana-family aliases (no `gemini-*-image` shape) are covered too.
      'nano-banana',
      'nano-banana-lite',
      'google/nano-banana-lite',
    ])('detects image-response model %s', (model) => {
      expect(isGoogleImageResponseModel(model)).toBe(true);
    });

    it('does not treat normal Gemini Pro as an image-response model', () => {
      expect(isGoogleImageResponseModel('gemini-3.5-pro')).toBe(false);
    });

    it('derives googleSearch support for Gemini 3+ image-response models', () => {
      expect(supportsGoogleSearchOnImageResponseModel('gemini-3.5-pro-image-preview')).toBe(true);
      expect(supportsGoogleSearchOnImageResponseModel('gemini-2.5-flash-image')).toBe(false);
      expect(supportsGoogleSearchOnImageResponseModel('nano-banana-pro-preview')).toBe(false);
    });

    it('keeps the imageSearch payload exception narrow', () => {
      expect(shouldUseGoogleImageSearchTypes('gemini-3.1-flash-image-preview')).toBe(true);
      expect(shouldUseGoogleImageSearchTypes('gemini-3.5-pro-image-preview')).toBe(false);
    });
  });

  describe('Nano Banana helpers', () => {
    it.each([
      'nano-banana-pro-preview',
      'google/nano-banana-pro-preview',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image-preview:image',
      'gemini-3.1-flash-image-preview:image',
      'gemini-3.1-flash-lite-image',
      'gemini-3.1-flash-lite-image:image',
    ])('detects Nano Banana model %s', (model) => {
      expect(isGoogleNanoBananaModel(model)).toBe(true);
    });

    it.each(['gemini-3.5-pro', 'gemini-3.5-pro:image', 'gemini-3.1-flash-lite', undefined])(
      'does not detect non-Nano Banana model %s',
      (model) => {
        expect(isGoogleNanoBananaModel(model)).toBe(false);
      },
    );
  });

  describe('payload guard helpers', () => {
    it('keeps the safety OFF exception exact after normalization', () => {
      expect(isGoogleSafetyOffModel('google/gemini-2.0-flash-exp')).toBe(true);
      expect(isGoogleSafetyOffModel('gemini-2.0-flash')).toBe(false);
    });

    it('derives system instruction disables from model-id shape', () => {
      expect(shouldDisableGoogleSystemInstruction('gemma-3-27b-it')).toBe(true);
      expect(shouldDisableGoogleSystemInstruction('gemma-4-31b-it')).toBe(false);
      expect(shouldDisableGoogleSystemInstruction('google/gemini-3.5-pro-image-preview')).toBe(
        true,
      );
      expect(shouldDisableGoogleSystemInstruction('gemini-3.5-pro')).toBe(false);
    });

    it('disables thinking config for LearnLM and known system-instruction-disabled models', () => {
      expect(shouldDisableGoogleThinkingConfig('learnlm-2.0-flash-experimental')).toBe(true);
      expect(shouldDisableGoogleThinkingConfig('gemini-2.5-flash-image')).toBe(true);
      expect(shouldDisableGoogleThinkingConfig('gemini-3.5-pro')).toBe(false);
    });
  });
});

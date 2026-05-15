// @vitest-environment node
import { type AiFullModelCard } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TOKENS_BUFFER,
  DEFAULT_MIN_OUTPUT_TOKENS,
  MaxTokensExceededError,
  resolveSafeMaxTokens,
} from './resolveSafeMaxTokens';

const baseModel = (overrides: Partial<AiFullModelCard> = {}): AiFullModelCard =>
  ({
    contextWindowTokens: 200_000,
    displayName: 'Test',
    id: 'test-model',
    maxOutput: 131_072,
    type: 'chat',
    ...overrides,
  }) as AiFullModelCard;

describe('resolveSafeMaxTokens', () => {
  it('returns the user-provided max_tokens unchanged', () => {
    const result = resolveSafeMaxTokens(
      {
        max_tokens: 4096,
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
      } as any,
      [baseModel()],
    );
    expect(result).toBe(4096);
  });

  it('returns undefined when the model is not found', () => {
    const result = resolveSafeMaxTokens(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'unknown',
      } as any,
      [baseModel()],
    );
    expect(result).toBeUndefined();
  });

  it('falls back to maxOutput when contextWindowTokens is missing', () => {
    const result = resolveSafeMaxTokens(
      {
        messages: [{ content: 'hi', role: 'user' }],
        model: 'test-model',
      } as any,
      [baseModel({ contextWindowTokens: undefined as any })],
    );
    expect(result).toBe(131_072);
  });

  it('uses maxOutput when input is small enough', () => {
    const result = resolveSafeMaxTokens(
      {
        messages: [{ content: 'short message', role: 'user' }],
        model: 'test-model',
      } as any,
      [baseModel({ contextWindowTokens: 200_000, maxOutput: 4096 })],
    );
    expect(result).toBe(4096);
  });

  it('caps max_tokens to remaining window when input is large', () => {
    // Build a payload large enough that contextWindow - input - buffer < maxOutput
    // contextWindow=10_000, maxOutput=8000, big input → must be capped below 8000.
    const longContent = 'a'.repeat(20_000); // ~5000+ estimated tokens
    const result = resolveSafeMaxTokens(
      {
        messages: [{ content: longContent, role: 'user' }],
        model: 'test-model',
      } as any,
      [baseModel({ contextWindowTokens: 10_000, maxOutput: 8000 })],
    );

    expect(result).toBeDefined();
    expect(result!).toBeLessThan(8000);
    expect(result!).toBeGreaterThanOrEqual(DEFAULT_MIN_OUTPUT_TOKENS);
  });

  it('throws MaxTokensExceededError when remaining window < minOutputTokens', () => {
    // contextWindow=2000, big input → no room left
    const longContent = 'a'.repeat(20_000);
    expect(() =>
      resolveSafeMaxTokens(
        {
          messages: [{ content: longContent, role: 'user' }],
          model: 'test-model',
        } as any,
        [baseModel({ contextWindowTokens: 2000, maxOutput: 8000 })],
      ),
    ).toThrow(MaxTokensExceededError);
  });

  it('attaches diagnostic data to MaxTokensExceededError', () => {
    const longContent = 'a'.repeat(20_000);
    try {
      resolveSafeMaxTokens(
        {
          messages: [{ content: longContent, role: 'user' }],
          model: 'tight-model',
        } as any,
        [baseModel({ contextWindowTokens: 2000, id: 'tight-model', maxOutput: 8000 })],
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MaxTokensExceededError);
      const err = error as MaxTokensExceededError;
      expect(err.modelId).toBe('tight-model');
      expect(err.contextWindowTokens).toBe(2000);
      expect(err.estimatedInputTokens).toBeGreaterThan(0);
      expect(err.minOutputTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
    }
  });

  it('factors tools into the input estimate', () => {
    // Same messages, but adding many tool definitions should reduce remaining headroom.
    const baseArgs = {
      messages: [{ content: 'hi', role: 'user' }],
      model: 'test-model',
    } as any;
    const models = [baseModel({ contextWindowTokens: 10_000, maxOutput: 8000 })];

    const withoutTools = resolveSafeMaxTokens(baseArgs, models);

    const heavyTool = {
      function: {
        description: 'x'.repeat(10_000),
        name: 'big_tool',
        parameters: { properties: {}, type: 'object' },
      },
      type: 'function',
    };
    const withTools = resolveSafeMaxTokens({ ...baseArgs, tools: [heavyTool] }, models);

    expect(withTools).toBeDefined();
    expect(withoutTools).toBeDefined();
    expect(withTools!).toBeLessThan(withoutTools!);
  });

  it('honors a custom buffer', () => {
    const models = [baseModel({ contextWindowTokens: 10_000, maxOutput: 100_000 })];
    const longContent = 'a'.repeat(8000); // ~2000 estimated tokens

    const defaultBuffer = resolveSafeMaxTokens(
      {
        messages: [{ content: longContent, role: 'user' }],
        model: 'test-model',
      } as any,
      models,
    );
    const largerBuffer = resolveSafeMaxTokens(
      {
        messages: [{ content: longContent, role: 'user' }],
        model: 'test-model',
      } as any,
      models,
      { bufferTokens: DEFAULT_MAX_TOKENS_BUFFER + 1000 },
    );

    expect(largerBuffer).toBe(defaultBuffer! - 1000);
  });
});

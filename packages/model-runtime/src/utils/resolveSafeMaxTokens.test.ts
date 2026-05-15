// @vitest-environment node
import { type AiFullModelCard } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  assertContextWithinWindow,
  CONTEXT_EXCEEDED_PRE_FLIGHT_TYPE,
  ContextExceededPreFlightError,
  DEFAULT_MAX_TOKENS_BUFFER,
  DEFAULT_MIN_OUTPUT_TOKENS,
  DEFAULT_PRE_FLIGHT_SUGGESTIONS,
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

  it('throws ContextExceededPreFlightError when remaining window < minOutputTokens', () => {
    const longContent = 'a'.repeat(20_000);
    expect(() =>
      resolveSafeMaxTokens(
        {
          messages: [{ content: longContent, role: 'user' }],
          model: 'test-model',
        } as any,
        [baseModel({ contextWindowTokens: 2000, maxOutput: 8000 })],
      ),
    ).toThrow(ContextExceededPreFlightError);
  });

  it('attaches structured diagnostic data to ContextExceededPreFlightError', () => {
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
      expect(error).toBeInstanceOf(ContextExceededPreFlightError);
      const err = error as ContextExceededPreFlightError;
      expect(err.type).toBe(CONTEXT_EXCEEDED_PRE_FLIGHT_TYPE);
      expect(err.model).toBe('tight-model');
      expect(err.ctx).toBe(2000);
      expect(err.promptTokens).toBeGreaterThan(0);
      expect(err.shortBy).toBe(err.promptTokens - err.ctx);
      expect(err.minOutputTokens).toBe(DEFAULT_MIN_OUTPUT_TOKENS);
      expect(err.suggestions).toEqual(DEFAULT_PRE_FLIGHT_SUGGESTIONS);
    }
  });

  it('factors tools into the input estimate', () => {
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

describe('assertContextWithinWindow', () => {
  it('is a no-op when input fits comfortably', () => {
    expect(() =>
      assertContextWithinWindow(
        { messages: [{ content: 'hi', role: 'user' }], model: 'test-model' } as any,
        [baseModel({ contextWindowTokens: 200_000 })],
      ),
    ).not.toThrow();
  });

  it('is a no-op when the model is unknown (we cannot decide)', () => {
    expect(() =>
      assertContextWithinWindow(
        { messages: [{ content: 'hi', role: 'user' }], model: 'unknown' } as any,
        [baseModel()],
      ),
    ).not.toThrow();
  });

  it('is a no-op when the model has no contextWindowTokens', () => {
    expect(() =>
      assertContextWithinWindow(
        {
          messages: [{ content: 'a'.repeat(1_000_000), role: 'user' }],
          model: 'test-model',
        } as any,
        [baseModel({ contextWindowTokens: undefined as any })],
      ),
    ).not.toThrow();
  });

  it('throws ContextExceededPreFlightError when prompt overflows the window', () => {
    const longContent = 'a'.repeat(20_000);
    expect(() =>
      assertContextWithinWindow(
        { messages: [{ content: longContent, role: 'user' }], model: 'tight-model' } as any,
        [baseModel({ contextWindowTokens: 2000, id: 'tight-model' })],
      ),
    ).toThrow(ContextExceededPreFlightError);
  });

  it('attaches LOBE-8974 structured payload via toPayload()', () => {
    const longContent = 'a'.repeat(20_000);
    try {
      assertContextWithinWindow(
        { messages: [{ content: longContent, role: 'user' }], model: 'tight-model' } as any,
        [baseModel({ contextWindowTokens: 2000, id: 'tight-model' })],
      );
      throw new Error('should have thrown');
    } catch (error) {
      const err = error as ContextExceededPreFlightError;
      const payload = err.toPayload();
      expect(payload.type).toBe('context_exceeded_pre_flight');
      expect(payload.model).toBe('tight-model');
      expect(payload.ctx).toBe(2000);
      expect(payload.shortBy).toBe(payload.promptTokens - payload.ctx);
      expect(payload.shortBy).toBeGreaterThan(0); // strict overflow path: shortBy must be positive
      expect(payload.suggestions).toEqual(['fork_topic', 'switch_to_larger_ctx_model']);
      // Pre-flight-only path doesn't enforce completion headroom, so the
      // payload omits the minOutputTokens field.
      expect((payload as any).minOutputTokens).toBeUndefined();
    }
  });

  it('does NOT reject a near-limit prompt that still fits within the window', () => {
    // Regression test for LOBE-8974 PR review feedback: the helper was
    // previously deducting a 1024 buffer + 1024 minOutputTokens and would
    // throw for a 198.5k-token prompt against a 200k-token window even
    // though the upstream would accept it. With the corrected threshold,
    // this must pass through.
    // ~4 chars per token, so 'a'.repeat(794_000) estimates to ~198.5k.
    const nearLimitContent = 'a'.repeat(794_000);

    expect(() =>
      assertContextWithinWindow(
        { messages: [{ content: nearLimitContent, role: 'user' }], model: 'big-model' } as any,
        [baseModel({ contextWindowTokens: 200_000, id: 'big-model' })],
      ),
    ).not.toThrow();
  });

  it('honors safetyMarginTokens for stricter callers', () => {
    // With no margin, a ~5k-token prompt against a 6k-token window fits.
    const baseArgs = {
      messages: [{ content: 'a'.repeat(20_000), role: 'user' }],
      model: 'snug-model',
    } as any;
    const models = [baseModel({ contextWindowTokens: 6000, id: 'snug-model' })];

    expect(() => assertContextWithinWindow(baseArgs, models)).not.toThrow();

    // With a generous margin, the same prompt is treated as overflow.
    expect(() => assertContextWithinWindow(baseArgs, models, { safetyMarginTokens: 3000 })).toThrow(
      ContextExceededPreFlightError,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { isEmptyModelCompletion } from './modelEmptyCompletion';

describe('isEmptyModelCompletion', () => {
  const base = {
    content: '',
    imageCount: 0,
    outputTokens: 0,
    reasoning: '',
    toolCallCount: 0,
  };

  it('treats a turn with real text content as non-empty', () => {
    expect(isEmptyModelCompletion({ ...base, content: 'hello' })).toBe(false);
  });

  it('treats a reasoning-only turn as non-empty', () => {
    expect(isEmptyModelCompletion({ ...base, reasoning: 'thinking...' })).toBe(false);
  });

  it('treats a tool-call turn as non-empty', () => {
    expect(isEmptyModelCompletion({ ...base, toolCallCount: 1 })).toBe(false);
  });

  it('treats an image turn as non-empty', () => {
    expect(isEmptyModelCompletion({ ...base, imageCount: 1 })).toBe(false);
  });

  it('flags a truly blank turn (no content, ~0 output tokens) as empty', () => {
    expect(isEmptyModelCompletion({ ...base, outputTokens: 1 })).toBe(true);
  });

  it('flags a blank turn with undefined output tokens as empty', () => {
    expect(isEmptyModelCompletion({ ...base, outputTokens: undefined })).toBe(true);
  });

  // The regression this guard closes: a post-tool answer turn where the model
  // generated tens of thousands of output tokens but the streamed text was
  // dropped before it reached `content`. Without a grounding signal, a high
  // output-token count must NOT be trusted as a real reply — otherwise the turn
  // silently finalizes to `done` with a blank, still-billed assistant message.
  it('flags empty content with high output tokens as empty when no grounding is present', () => {
    expect(
      isEmptyModelCompletion({ ...base, outputTokens: 25_220, reasoning: '', content: '' }),
    ).toBe(true);
  });

  it('does not flag empty content with high output tokens when grounding IS present', () => {
    // Grounding/citation metadata legitimately consumes tokens without emitting
    // text we accumulate — keep the original escape hatch for that case only.
    expect(isEmptyModelCompletion({ ...base, outputTokens: 25_220, hasGrounding: true })).toBe(
      false,
    );
  });

  it('ignores grounding when it did not consume output tokens', () => {
    expect(isEmptyModelCompletion({ ...base, outputTokens: 1, hasGrounding: true })).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { isExceededContextWindowError } from './isExceededContextWindowError';

describe('isExceededContextWindowError', () => {
  it('should return false for undefined/empty input', () => {
    expect(isExceededContextWindowError(undefined)).toBe(false);
    expect(isExceededContextWindowError('')).toBe(false);
  });

  it('should detect OpenAI/DeepSeek "maximum context length" errors', () => {
    expect(
      isExceededContextWindowError(
        "This model's maximum context length is 131072 tokens. However, your messages resulted in 140000 tokens.",
      ),
    ).toBe(true);
  });

  it('should detect OpenAI "context length exceeded" errors', () => {
    expect(isExceededContextWindowError('context length exceeded')).toBe(true);
  });

  it('should detect OpenAI "context_length_exceeded" code in message', () => {
    expect(isExceededContextWindowError('Error code: context_length_exceeded')).toBe(true);
  });

  it('should detect MiniMax "context window exceeds" errors', () => {
    expect(
      isExceededContextWindowError('invalid params, context window exceeds limit (2013)'),
    ).toBe(true);
  });

  it('should detect Aihubmix "exceeds the context window" errors', () => {
    expect(
      isExceededContextWindowError('This request exceeds the context window of this model'),
    ).toBe(true);
  });

  it('should detect Anthropic "prompt is too long" errors', () => {
    expect(isExceededContextWindowError('prompt is too long: 231426 tokens > 200000 maximum')).toBe(
      true,
    );
  });

  it('should detect Anthropic "input is too long" errors', () => {
    expect(isExceededContextWindowError('input is too long for this model')).toBe(true);
  });

  it('should detect Bedrock "too many input tokens" errors', () => {
    expect(isExceededContextWindowError('too many input tokens')).toBe(true);
  });

  it('should detect Google "exceeds the maximum number of tokens" errors', () => {
    expect(
      isExceededContextWindowError(
        'The input token count exceeds the maximum number of tokens allowed',
      ),
    ).toBe(true);
  });

  it('should detect "maximum allowed number of input tokens" errors', () => {
    expect(isExceededContextWindowError('maximum allowed number of input tokens is 128000')).toBe(
      true,
    );
  });

  it('should detect "request too large for model" errors', () => {
    expect(isExceededContextWindowError('request too large for model')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isExceededContextWindowError('MAXIMUM CONTEXT LENGTH exceeded')).toBe(true);
    expect(isExceededContextWindowError('Prompt Is Too Long')).toBe(true);
  });

  it('should return false for unrelated error messages', () => {
    expect(isExceededContextWindowError('Invalid API key')).toBe(false);
    expect(isExceededContextWindowError('Rate limit exceeded')).toBe(false);
    expect(isExceededContextWindowError('Internal server error')).toBe(false);
  });
});

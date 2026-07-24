import { describe, expect, it, vi } from 'vitest';

import {
  executeToolWithRetry,
  getLLMRetryDelayMs,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldRetryLLM,
} from './runtimeRetry';

describe('runtimeRetry', () => {
  it('resolves LLM retry policy from provider-level configuration only', () => {
    const options = { noRetryProviders: ['lobehub'] };

    expect(resolveLLMRetryBudget('openai', options)).toBe(5);
    expect(resolveLLMRetryBudget('lobehub', options)).toBe(0);
    expect(resolveLLMMaxAttempts('openai', options)).toBe(6);
    expect(resolveLLMMaxAttempts('lobehub', options)).toBe(1);
  });

  it('calculates exponential LLM retry delay with a cap', () => {
    expect(getLLMRetryDelayMs(1)).toBe(1000);
    expect(getLLMRetryDelayMs(2)).toBe(2000);
    expect(getLLMRetryDelayMs(99)).toBe(30_000);
    expect(shouldRetryLLM('retry', 2, 2)).toBe(true);
    expect(shouldRetryLLM('retry', 3, 2)).toBe(false);
    expect(shouldRetryLLM('stop', 1, 2)).toBe(false);
  });

  it('retries tool execution while kind is retry and stops on success', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ error: { kind: 'retry' }, success: false })
      .mockResolvedValueOnce({ content: 'done', success: true });
    const onRetry = vi.fn();

    const result = await executeToolWithRetry(execute, {
      maxRetries: 2,
      onRetry,
    });

    expect(result.attempts).toBe(2);
    expect(result.result).toEqual({ content: 'done', success: true });
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, kind: 'retry', maxAttempts: 3 });
  });

  it('stops tool retries when interrupted', async () => {
    const firstResult = { error: { kind: 'retry' }, success: false };
    const execute = vi.fn().mockResolvedValue(firstResult);

    const result = await executeToolWithRetry(execute, {
      isInterrupted: async () => true,
      maxRetries: 2,
    });

    expect(result).toEqual({ attempts: 1, result: firstResult });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

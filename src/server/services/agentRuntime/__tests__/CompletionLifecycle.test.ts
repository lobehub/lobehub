// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CompletionLifecycle } from '../CompletionLifecycle';

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.extractErrorMessage', () => {
  it('extracts message from ChatCompletionErrorPayload (InsufficientBudgetForModel)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Budget exceeded');
  });

  it('extracts message from ChatCompletionErrorPayload (InvalidProviderAPIKey)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      endpoint: 'https://cdn.example.com/v1',
      error: {
        code: '',
        error: { code: '', message: '无效的令牌', type: 'new_api_error' },
        message: '无效的令牌',
        status: 401,
        type: 'new_api_error',
      },
      errorType: 'InvalidProviderAPIKey',
      provider: 'openai',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('无效的令牌');
  });

  it('extracts message from formatted ChatMessageError with body.error.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { error: { message: 'Rate limit exceeded' } },
      message: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Rate limit exceeded');
  });

  it('extracts message from ChatMessageError with body.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { message: 'Something went wrong' },
      message: 'error',
      type: 'InternalServerError',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Something went wrong');
  });

  it('falls back to error.message when body is absent', () => {
    const lifecycle = buildLifecycle();
    const error = { message: 'Connection timeout', type: 'NetworkError' };

    expect(lifecycle.extractErrorMessage(error)).toBe('Connection timeout');
  });

  it('falls back to errorType when message is "error"', () => {
    const lifecycle = buildLifecycle();
    const error = { errorType: 'InsufficientBudgetForModel', message: 'error' };

    expect(lifecycle.extractErrorMessage(error)).toBe('InsufficientBudgetForModel');
  });

  it('returns undefined for null/undefined', () => {
    const lifecycle = buildLifecycle();

    expect(lifecycle.extractErrorMessage(null)).toBeUndefined();
    expect(lifecycle.extractErrorMessage(undefined)).toBeUndefined();
  });

  it('never returns [object Object] for nested error objects', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    const result = lifecycle.extractErrorMessage(error);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result).toBe('Budget exceeded');
  });
});

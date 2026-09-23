import { describe, expect, it } from 'vitest';

import { normalizeChatMessageError } from './normalizeChatMessageError';

describe('normalizeChatMessageError', () => {
  it.each([
    { body: { error: { message: 'insufficient quota' } }, type: 'ProviderBizError' },
    { error: { message: 'insufficient quota' }, errorType: 'ProviderBizError' },
    { message: 'insufficient quota' },
    'insufficient quota',
  ])('normalizes equivalent quota errors: %j', (input) => {
    const result = normalizeChatMessageError(input);
    expect(result).toMatchObject({
      attribution: 'user',
      message: 'insufficient quota',
      numericId: 2001,
      retryable: false,
      type: 'InsufficientQuota',
    });
    expect(normalizeChatMessageError(result)).toEqual(result);
  });

  it('preserves a non-enumerable Error message with a known errorType', () => {
    const error = Object.assign(new Error('provider credentials rejected'), {
      errorType: 'InvalidProviderAPIKey',
    });
    expect(normalizeChatMessageError(error)).toMatchObject({
      message: 'provider credentials rejected',
      type: 'InvalidProviderAPIKey',
    });
  });

  it('keeps a known code authoritative over a misleading message', () => {
    expect(
      normalizeChatMessageError({ code: 'PermissionDenied', message: 'insufficient quota' }),
    ).toMatchObject({ type: 'PermissionDenied' });
  });

  it('preserves hetero guide metadata and recovery context', () => {
    const body = {
      agentType: 'claude-code',
      code: 'rate_limit',
      details: { kind: 'usage_limit' },
      message: 'Weekly allowance exhausted',
      rateLimitInfo: { rateLimitType: 'seven_day', resetsAt: 1789826400 },
    };
    expect(normalizeChatMessageError(body)).toMatchObject({ body });
  });

  it('merges upstream status with display context and preserves budget', () => {
    const result = normalizeChatMessageError({
      _responseBody: { error: { message: 'Payment required' } },
      budget: { budgetTypeAtError: 'workspace' },
      error: { status: 402 },
      errorType: 'ProviderBizError',
      provider: 'lobehub',
    });
    expect(result).toMatchObject({
      body: {
        budget: { budgetTypeAtError: 'workspace' },
        error: { message: 'Payment required', status: 402 },
        provider: 'lobehub',
      },
      type: 'InsufficientQuota',
    });
  });

  it('keeps hook display fields when a stream error already carries a provider body', () => {
    const providerBody = { message: 'Provider timed out', provider: 'lobehub' };
    const result = normalizeChatMessageError({
      _responseBody: { traceId: 'trace-1' },
      body: providerBody,
      errorType: 'ProviderBizError',
      message: 'LLM stream error: Provider timed out',
    });

    expect(result.body).toMatchObject({ ...providerBody, traceId: 'trace-1' });
  });

  it('does not infer a provider outage from an unclassified internal 500', () => {
    expect(normalizeChatMessageError(new Error('500 unexpected internal failure'))).toMatchObject({
      type: 500,
    });
  });
});

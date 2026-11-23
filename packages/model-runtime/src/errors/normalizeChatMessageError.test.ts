import { BRANDING_NAME, getProviderDisplayIdentifier } from '@lobechat/const';
import { DATABASE_ERROR_PUBLIC_MESSAGE } from '@lobechat/utils/queryError';
import { describe, expect, it } from 'vitest';

import { normalizeChatMessageError } from './normalizeChatMessageError';

const expectedDefaultProvider = getProviderDisplayIdentifier('lobehub');

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
        provider: expectedDefaultProvider,
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

    expect(result.body).toMatchObject({
      message: 'Provider timed out',
      provider: expectedDefaultProvider,
      traceId: 'trace-1',
    });
  });

  it('keeps hook display fields on a typed stream error payload', () => {
    const providerBody = { code: 500, message: 'Internal error', provider: 'lobehub' };
    const result = normalizeChatMessageError({
      _responseBody: { traceId: 'trace-1' },
      body: providerBody,
      message: 'Internal error',
      type: 'ProviderBizError',
    });

    expect(result.body).toEqual({
      code: 500,
      message: 'Internal error',
      provider: expectedDefaultProvider,
      traceId: 'trace-1',
    });
    expect(result).not.toHaveProperty('_responseBody');
  });

  it('sanitizes upstream lobehub keys, default provider, and brand text on custom builds', () => {
    const result = normalizeChatMessageError({
      error: {
        code: 'request_rejected',
        lobehub_request_id: 'req-1',
        message: 'IP blocked by LobeHub proxy',
        type: 'ai_hub_error',
      },
      errorType: 'ProviderBizError',
      provider: 'lobehub',
    });

    expect(result.body).toEqual({
      code: 'request_rejected',
      message: `IP blocked by ${BRANDING_NAME} proxy`,
      provider: expectedDefaultProvider,
      type: 'ai_hub_error',
    });
    expect(result.message).toBe(`IP blocked by ${BRANDING_NAME} proxy`);
  });

  it('keeps hook display fields on a plain Error', () => {
    const error = Object.assign(new TypeError('terminated'), {
      _responseBody: { traceId: 'trace-1' },
    });

    expect(normalizeChatMessageError(error)).toMatchObject({
      body: { name: 'TypeError', traceId: 'trace-1' },
      message: 'terminated',
    });
  });

  it('does not infer a provider outage from an unclassified internal 500', () => {
    expect(normalizeChatMessageError(new Error('500 unexpected internal failure'))).toMatchObject({
      type: 500,
    });
  });

  describe('database query detail', () => {
    const sql =
      'Failed query: select "id" from "messages" where "id" = $1\nparams: msg_q9Utuc2kAGXSkuMutD';

    it.each([
      ['a thrown Drizzle error', new Error(sql)],
      [
        'a typed payload carrying the query in its error',
        { error: { message: sql }, errorType: 'AgentRuntimeError' },
      ],
      [
        'an already-normalized error',
        {
          body: { name: 'Error', stack: `Error: ${sql}` },
          message: sql,
          type: 'DatabasePersistError',
        },
      ],
    ])('keeps no SQL or parameters for %s', (_, input) => {
      const result = normalizeChatMessageError(input);

      expect(result.message).toBe(DATABASE_ERROR_PUBLIC_MESSAGE);
      expect(JSON.stringify(result)).not.toMatch(/select|msg_q9Utuc2kAGXSkuMutD|Failed query/);
    });

    it('keeps display fields that carry no query detail', () => {
      const result = normalizeChatMessageError({
        body: { stack: `Error: ${sql}`, traceId: 'trace-1' },
        message: sql,
        type: 'DatabasePersistError',
      });

      expect(result.body).toEqual({ traceId: 'trace-1' });
    });
  });

  it('does not store the stack of a thrown Error', () => {
    expect(normalizeChatMessageError(new Error('boom')).body).toEqual({ name: 'Error' });
  });
});

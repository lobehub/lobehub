import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { isNonRetryableRequestError } from './isNonRetryableRequestError';

describe('isNonRetryableRequestError', () => {
  it('returns true for ExceededContextWindow errors', () => {
    expect(
      isNonRetryableRequestError({
        error: { message: 'Too many input tokens' },
        errorType: AgentRuntimeErrorType.ExceededContextWindow,
      }),
    ).toBe(true);
  });

  it('returns true for invalid request payload errors', () => {
    expect(
      isNonRetryableRequestError({
        error: {
          body: { httpStatusCode: 400 },
          message: 'This model maximum input length is 128000 tokens. Please reduce your input.',
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('returns true for invalid response_format schema errors', () => {
    expect(
      isNonRetryableRequestError({
        error: {
          message:
            "Invalid schema for response_format 'json_schema': schema must be a JSON Schema.",
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('returns true for assistant prefill request-shape errors', () => {
    expect(
      isNonRetryableRequestError({
        error: {
          body: { httpStatusCode: 400 },
          message:
            'This model does not support assistant message prefill. The conversation must end with a user message.',
          type: 'ValidationException',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('returns false for bare 400/413/422 request errors', () => {
    expect(isNonRetryableRequestError({ errorType: 'ProviderBizError', status: 400 })).toBe(false);
    expect(isNonRetryableRequestError({ errorType: 'ProviderBizError', status: 413 })).toBe(false);
    expect(isNonRetryableRequestError({ errorType: 'ProviderBizError', status: 422 })).toBe(false);
  });

  it('returns false for retryable rate limit and quota errors', () => {
    expect(
      isNonRetryableRequestError({
        error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for requests' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 429,
      }),
    ).toBe(false);

    expect(
      isNonRetryableRequestError({
        error: { code: 'insufficient_quota', message: 'You exceeded your current quota' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 429,
      }),
    ).toBe(false);
  });

  it('returns false for channel-specific auth and model errors', () => {
    expect(
      isNonRetryableRequestError({
        error: { message: 'Unauthorized: invalid API key' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        status: 400,
      }),
    ).toBe(false);

    expect(
      isNonRetryableRequestError({
        error: { code: 'DeploymentNotFound', message: 'The deployment does not exist.' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 404,
      }),
    ).toBe(false);
  });
});

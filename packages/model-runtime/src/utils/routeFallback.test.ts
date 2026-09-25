import { describe, expect, it } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { isImageDecodingRequestError, shouldStopFallbackForError } from './routeFallback';

describe('shouldStopFallbackForError', () => {
  it('stops fallback for ExceededContextWindow errors', () => {
    expect(
      shouldStopFallbackForError({
        error: { message: 'Too many input tokens' },
        errorType: AgentRuntimeErrorType.ExceededContextWindow,
      }),
    ).toBe(true);
  });

  it('stops fallback for an oversized upstream request body', () => {
    expect(
      shouldStopFallbackForError({
        error: { message: '<html>413 Request Entity Too Large</html>', status: 413 },
        errorType: AgentRuntimeErrorType.RequestBodyTooLarge,
      }),
    ).toBe(true);
  });

  it('stops fallback for terminal image generation errors', () => {
    expect(
      shouldStopFallbackForError({
        error: { message: 'Google image generation was blocked by content policy.' },
        errorType: AgentRuntimeErrorType.ProviderContentPolicyViolation,
      }),
    ).toBe(true);

    expect(
      shouldStopFallbackForError({
        error: { message: 'The provider did not return an image.' },
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      }),
    ).toBe(true);
  });

  it('stops fallback for provider image decoding request errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          message:
            '400 INVALID_ARGUMENT: Failed to decode image data. Please make sure the image is valid.',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);

    expect(
      shouldStopFallbackForError({
        error: { message: 'Unable to process input image' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);

    expect(
      isImageDecodingRequestError({
        error: { message: 'Unable to process input image' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
    expect(isImageDecodingRequestError({ message: 'Invalid request payload' })).toBe(false);
  });

  it('stops fallback for invalid request payload errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          body: { httpStatusCode: 400 },
          message: 'This model maximum input length is 128000 tokens. Please reduce your input.',
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('allows fallback for a structured remote media download timeout', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          code: 'invalid_value',
          error: {
            code: 'invalid_value',
            message:
              'Unable to download content from the provided URL before the timeout. Check that the URL is publicly accessible and responds promptly, or upload the file and provide a file_id instead.',
            param: 'url',
            type: 'invalid_request_error',
          },
          param: 'url',
          status: 400,
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.RemoteMediaDownloadTimeout,
        provider: 'azure',
      }),
    ).toBe(false);
  });

  it('allows fallback for a per-channel image count limit', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          code: null,
          message: 'Exceeded maximum number of images (50) allowed in the request.',
          param: 'input',
          status: 400,
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.ExceededImageLimit,
        provider: 'azure',
      }),
    ).toBe(false);
  });

  it('does not infer remote media timeout semantics from raw provider text', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          code: 'invalid_value',
          message: 'Unable to download content from the provided URL before the timeout.',
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);
  });

  it('stops fallback for provider request-body-too-large context errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          message: 'Request body too large for gpt-4o model',
          type: 'invalid_request_error',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);
  });

  it('returns true for provider content_filter moderation errors', () => {
    // ROOT CAUSE:
    //
    // OpenAI-compatible providers can return content filter rejections as 400
    // responses with `code`, `type`, or `finish_reason` set to
    // "content_filter" instead of a structured runtime error type. If the
    // router treats that raw provider payload as fallback-eligible, one blocked prompt
    // can fan out across fallback channels.
    //
    // Before the fix, this returned false because `content_filter` was not in
    // the terminal error code set.
    //
    // We fixed this by treating provider moderation signals as terminal request
    // errors at the Router fallback gate.
    expect(
      shouldStopFallbackForError({
        error: {
          code: 'content_filter',
          message: 'The provider blocked this prompt.',
          type: 'content_filter',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);

    expect(
      shouldStopFallbackForError({
        error: {
          choices: [{ finish_reason: 'content_policy_violation' }],
          message: 'The provider blocked this prompt.',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 400,
      }),
    ).toBe(true);
  });

  it('stops fallback for invalid response_format schema errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          message:
            "Invalid schema for response_format 'json_schema': schema must be a JSON Schema.",
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('stops fallback for unsupported model parameter errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          error: {
            code: 'bad_response_status_code',
            message: 'Model grok-4.20-0309-reasoning does not support parameter presencePenalty.',
            param: '400',
            type: 'upstream_error',
          },
          message: '400 Model grok-4.20-0309-reasoning does not support parameter presencePenalty.',
        },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBe(true);
  });

  it('stops fallback for assistant prefill request-shape errors', () => {
    expect(
      shouldStopFallbackForError({
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

  it('allows fallback for bare 400/413/422 request errors', () => {
    expect(shouldStopFallbackForError({ errorType: 'ProviderBizError', status: 400 })).toBe(false);
    expect(shouldStopFallbackForError({ errorType: 'ProviderBizError', status: 413 })).toBe(false);
    expect(shouldStopFallbackForError({ errorType: 'ProviderBizError', status: 422 })).toBe(false);
  });

  it('allows fallback for rate limit and quota errors', () => {
    expect(
      shouldStopFallbackForError({
        error: { message: 'Unable to process input image' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 429,
      }),
    ).toBe(false);

    expect(
      shouldStopFallbackForError({
        error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for requests' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 429,
      }),
    ).toBe(false);

    expect(
      shouldStopFallbackForError({
        error: { code: 'insufficient_quota', message: 'You exceeded your current quota' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 429,
      }),
    ).toBe(false);
  });

  it('allows fallback for standardized provider account balance errors', () => {
    expect(
      shouldStopFallbackForError({
        error: {
          code: 'invalid_request_error',
          message: 'Insufficient Balance',
          type: 'unknown_error',
        },
        errorType: AgentRuntimeErrorType.InsufficientQuota,
        status: 402,
      }),
    ).toBe(false);
  });

  it('allows fallback for channel-specific auth and model errors', () => {
    expect(
      shouldStopFallbackForError({
        error: { message: 'Unauthorized: invalid API key' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        status: 400,
      }),
    ).toBe(false);

    expect(
      shouldStopFallbackForError({
        error: { code: 'DeploymentNotFound', message: 'The deployment does not exist.' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
        status: 404,
      }),
    ).toBe(false);
  });
});

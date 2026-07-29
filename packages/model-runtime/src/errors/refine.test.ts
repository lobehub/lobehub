import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { refineErrorCode } from './refine';

describe('refineErrorCode', () => {
  it('does not touch a specific (non-refinable) errorType', () => {
    expect(
      refineErrorCode({
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        message: '429 status code (no body)',
      }),
    ).toBeUndefined();
  });

  describe('un-typed throw wrappers', () => {
    // A raw `Error` (e.g. a Drizzle "Failed query: …" throw) is wrapped by
    // formatErrorForState as InternalServerError (HTTP 500). It must still reach
    // the message patterns, otherwise it persists as a bare, un-classified 500.
    it('reclassifies a 500-wrapped Drizzle throw into DatabasePersistError', () => {
      expect(
        refineErrorCode({
          errorType: String(ChatErrorType.InternalServerError),
          message: 'Failed query: rollback\nparams: ',
        }),
      ).toBe(AgentRuntimeErrorType.DatabasePersistError);
    });

    it('reclassifies an AgentRuntimeError-wrapped throw via its message', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.AgentRuntimeError,
          message: 'Failed query: select "id" from "messages"',
        }),
      ).toBe(AgentRuntimeErrorType.DatabasePersistError);
    });

    it('leaves a 500 wrapper unrefined when nothing matches', () => {
      expect(
        refineErrorCode({
          errorType: String(ChatErrorType.InternalServerError),
          message: 'some opaque internal failure with no registered pattern',
        }),
      ).toBeUndefined();
    });

    // The HTTP-status fallback is provider-only: a leading "429"/"500" in a
    // harness/DB/Redis throw is not a real upstream status and must NOT recast
    // the error with provider retry/failure semantics.
    it('does not apply the HTTP-status fallback to un-typed wrappers', () => {
      expect(
        refineErrorCode({
          errorType: String(ChatErrorType.InternalServerError),
          message: '429 some harness throw with no registered pattern',
        }),
      ).toBeUndefined();
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.AgentRuntimeError,
          httpStatus: 500,
          message: 'opaque internal failure',
        }),
      ).toBeUndefined();
    });
  });

  describe('message-pattern pass', () => {
    it('reclassifies a rate-limit message into RateLimitExceeded', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '429 status code (no body)',
        }),
      ).toBe(AgentRuntimeErrorType.RateLimitExceeded);
    });

    it('reclassifies a 503 service message into ProviderServiceUnavailable', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '503 Service temporarily unavailable',
        }),
      ).toBe(AgentRuntimeErrorType.ProviderServiceUnavailable);
    });

    it('reclassifies the SDK "Connection error." wrapper into ProviderNetworkError', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: 'Connection error.',
        }),
      ).toBe(AgentRuntimeErrorType.ProviderNetworkError);
    });

    it('routes a rolling weekly cap to InsufficientQuota (not the 429 rate-limit fallback)', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '429 Weekly usage limit reached. Resets in 2 days. To continue using this…',
        }),
      ).toBe(AgentRuntimeErrorType.InsufficientQuota);
    });

    it('routes gateway HTML / openresty to UpstreamGatewayError', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '<center>openresty</center>',
        }),
      ).toBe(AgentRuntimeErrorType.UpstreamGatewayError);
    });

    it('routes a marshal failure to UpstreamMalformedResponse', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: 'failed to marshal request body to JSON',
        }),
      ).toBe(AgentRuntimeErrorType.UpstreamMalformedResponse);
    });

    it('routes a bare "400 status code" to UpstreamHttpError', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '400 status code (no body)',
        }),
      ).toBe(AgentRuntimeErrorType.UpstreamHttpError);
    });
  });

  describe('HTTP-status fallback (no message match)', () => {
    it('uses the structured status when the message carries no pattern', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          httpStatus: 402,
          message: 'some opaque upstream text',
        }),
      ).toBe(AgentRuntimeErrorType.InsufficientQuota);
    });

    it('falls back to the leading status in the message when no structured status', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message: '500 upstream blew up in a way we have never seen',
        }),
      ).toBe(AgentRuntimeErrorType.ProviderServiceUnavailable);
    });

    it('buckets other 4xx with no context into UpstreamHttpError', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          httpStatus: 409,
          message: 'conflict, no details',
        }),
      ).toBe(AgentRuntimeErrorType.UpstreamHttpError);
    });
  });

  it('keeps a genuine ProviderBizError residual unrefined', () => {
    expect(
      refineErrorCode({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: 'Upstream request failed',
      }),
    ).toBeUndefined();
  });

  describe('re-refines the fallback buckets themselves', () => {
    // formatErrorForState is idempotent: an inner pass can demote a
    // ProviderBizError to UpstreamHttpError (4xx + no recognized message), then
    // an outer pass re-enriches. UpstreamHttpError must stay refinable so the
    // later pass can still upgrade it once the message is recognizable.
    it('upgrades an UpstreamHttpError once its message matches a pattern', () => {
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.UpstreamHttpError,
          message: 'Hệ thống đang bận, vui lòng thử lại sau ít phút.',
        }),
      ).toBe(AgentRuntimeErrorType.ProviderServiceUnavailable);
    });

    it('leaves an UpstreamHttpError untouched when nothing matches', () => {
      // No status fallback for UpstreamHttpError (status-refinable is
      // ProviderBizError only), so an unrecognized 4xx residual stays put.
      expect(
        refineErrorCode({
          errorType: AgentRuntimeErrorType.UpstreamHttpError,
          httpStatus: 409,
          message: 'conflict, no details',
        }),
      ).toBeUndefined();
    });

    it('upgrades a bare-500 (InternalServerError) once its message matches', () => {
      expect(
        refineErrorCode({
          errorType: String(ChatErrorType.InternalServerError),
          message: '参数错误超过100个',
        }),
      ).toBe(AgentRuntimeErrorType.InvalidRequestFormat);
    });
  });
});

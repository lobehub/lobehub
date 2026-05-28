import { AgentRuntimeErrorType } from '@lobechat/types';
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
});

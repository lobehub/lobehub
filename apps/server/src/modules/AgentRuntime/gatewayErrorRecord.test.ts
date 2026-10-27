import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { shouldRecordGatewayError } from './gatewayErrorRecord';

describe('shouldRecordGatewayError', () => {
  it.each([
    ['operational failure', AgentRuntimeErrorType.ProviderBizError, 'openai', true],
    ['empty completion', AgentRuntimeErrorType.ModelEmptyCompletion, 'openai', true],
    ['unknown code', 'SomethingNew', 'openai', true],
    ['missing code', undefined, 'openai', true],
    ['user quota', AgentRuntimeErrorType.InsufficientQuota, 'openai', false],
    [
      'user quota on our provider',
      AgentRuntimeErrorType.InsufficientQuota,
      BRANDING_PROVIDER,
      false,
    ],
    ['content policy', AgentRuntimeErrorType.ProviderContentPolicyViolation, 'google', false],
    ['config error', AgentRuntimeErrorType.UserConfigError, 'openai', false],
    ['BYOK rate limit', AgentRuntimeErrorType.RateLimitExceeded, 'openai', false],
    ['BYOK outage', AgentRuntimeErrorType.ProviderServiceUnavailable, 'newapi', false],
    ['our rate limit', AgentRuntimeErrorType.RateLimitExceeded, BRANDING_PROVIDER, true],
    ['our outage', AgentRuntimeErrorType.ProviderServiceUnavailable, BRANDING_PROVIDER, true],
    ['rate limit with unknown provider', AgentRuntimeErrorType.RateLimitExceeded, undefined, true],
    ['aliased quota limit on BYOK', AgentRuntimeErrorType.QuotaLimitReached, 'openai', false],
    ['system network error', AgentRuntimeErrorType.ProviderNetworkError, 'openai', true],
    ['context window', AgentRuntimeErrorType.ExceededContextWindow, 'openai', true],
    ['request body too large', AgentRuntimeErrorType.RequestBodyTooLarge, 'openai', true],
    ['request shape', AgentRuntimeErrorType.InvalidRequestFormat, 'google', true],
  ] as const)('%s → %s', (_label, errorType, provider, expected) => {
    expect(shouldRecordGatewayError({ errorType, provider })).toBe(expected);
  });

  describe('normalized error classification', () => {
    // A platform admission refusal keeps the numeric `Forbidden` type, which
    // has no spec; the normalizer classifies it on the error itself.
    const forbidden = '403';

    it('keeps a user-side refusal without a spec off the board', () => {
      expect(
        shouldRecordGatewayError({
          error: { attribution: 'user', countAsFailure: false },
          errorType: forbidden,
          provider: BRANDING_PROVIDER,
        }),
      ).toBe(false);
    });

    it('files an unclassified refusal', () => {
      expect(shouldRecordGatewayError({ error: {}, errorType: forbidden })).toBe(true);
    });

    it('files a refusal the normalizer counts as a failure', () => {
      expect(
        shouldRecordGatewayError({
          error: { attribution: 'harness', countAsFailure: true },
          errorType: forbidden,
        }),
      ).toBe(true);
    });

    it('overrides the generic type a heterogeneous CLI failure keeps', () => {
      // A Claude Code session limit stays `AgentRuntimeError`, whose spec
      // counts as a failure; the CLI classification says it is the user's.
      expect(
        shouldRecordGatewayError({
          error: { attribution: 'user', countAsFailure: false },
          errorType: AgentRuntimeErrorType.AgentRuntimeError,
          provider: 'claude-code',
        }),
      ).toBe(false);
    });

    it('keeps a CLI capacity error off the board for the CLI provider', () => {
      expect(
        shouldRecordGatewayError({
          error: { attribution: 'provider', countAsFailure: false },
          errorType: AgentRuntimeErrorType.AgentRuntimeError,
          provider: 'codex',
        }),
      ).toBe(false);
    });
  });
});

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
    ['aliased quota limit on BYOK', AgentRuntimeErrorType.QuotaLimitReached, 'openai', false],
    ['system network error', AgentRuntimeErrorType.ProviderNetworkError, 'openai', true],
    ['context window', AgentRuntimeErrorType.ExceededContextWindow, 'openai', true],
    ['request body too large', AgentRuntimeErrorType.RequestBodyTooLarge, 'openai', true],
    ['request shape', AgentRuntimeErrorType.InvalidRequestFormat, 'google', true],
  ] as const)('%s → %s', (_label, errorType, provider, expected) => {
    expect(shouldRecordGatewayError({ errorType, provider })).toBe(expected);
  });
});

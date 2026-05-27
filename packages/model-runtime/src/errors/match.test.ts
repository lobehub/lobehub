import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isUserSideError, matchErrorPattern } from './match';
import { ERROR_CODE_SPECS } from './specs';

describe('matchErrorPattern', () => {
  it('returns undefined for empty input', () => {
    expect(matchErrorPattern({})).toBeUndefined();
    expect(matchErrorPattern({ message: '' })).toBeUndefined();
  });

  it('matches case-insensitive substring patterns', () => {
    expect(matchErrorPattern({ message: 'PROMPT IS TOO LONG' })?.code).toBe(
      AgentRuntimeErrorType.ExceededContextWindow,
    );
  });

  it('disambiguates 429-class rate limit from balance-class quota', () => {
    expect(matchErrorPattern({ message: 'rate_limit_exceeded' })?.code).toBe(
      AgentRuntimeErrorType.QuotaLimitReached,
    );
    expect(matchErrorPattern({ message: 'Insufficient Balance: recharge' })?.code).toBe(
      AgentRuntimeErrorType.InsufficientQuota,
    );
  });

  it('classifies provider 503 overload', () => {
    expect(matchErrorPattern({ message: 'Our servers are currently overloaded' })?.code).toBe(
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    );
  });

  it('classifies content moderation', () => {
    expect(matchErrorPattern({ message: 'Content Exists Risk' })?.code).toBe(
      AgentRuntimeErrorType.ContentModeration,
    );
  });

  it('classifies router/no-channel failures separately from biz error', () => {
    expect(matchErrorPattern({ message: 'No available keys in pool' })?.code).toBe(
      AgentRuntimeErrorType.NoAvailableChannel,
    );
  });

  it('classifies gemini-bridge proxy bugs as InvalidRequestFormat', () => {
    expect(
      matchErrorPattern({ message: 'For schema with properties, schema type should be OBJECT' })
        ?.code,
    ).toBe(AgentRuntimeErrorType.InvalidRequestFormat);
  });

  it('returns undefined for genuinely unknown errors', () => {
    expect(matchErrorPattern({ message: 'something we have never seen before' })).toBeUndefined();
  });
});

describe('isUserSideError', () => {
  it('returns true when errorType has a non-failure spec', () => {
    expect(isUserSideError(AgentRuntimeErrorType.InvalidProviderAPIKey)).toBe(true);
    expect(isUserSideError(AgentRuntimeErrorType.QuotaLimitReached)).toBe(true);
    expect(isUserSideError(AgentRuntimeErrorType.ExceededContextWindow)).toBe(true);
  });

  it('returns false for harness-attributed errors', () => {
    expect(isUserSideError(AgentRuntimeErrorType.StreamChunkError)).toBe(false);
    expect(isUserSideError(AgentRuntimeErrorType.OperationInactivityTimeout)).toBe(false);
    expect(isUserSideError(AgentRuntimeErrorType.AgentRuntimeError)).toBe(false);
  });

  it('upgrades a misclassified harness errorType via message pattern', () => {
    // Harness sometimes labels TPM rejections as ExceededContextWindow or 500.
    // The message pattern wins and rescues the classification.
    expect(
      isUserSideError(
        'ExceededContextWindow',
        'Rate limit reached for organization on tokens per minute (TPM)',
      ),
    ).toBe(true);
  });

  it('returns false when neither type nor message matches', () => {
    expect(isUserSideError(undefined, 'random unmatchable upstream error')).toBe(false);
  });

  it('every spec code lookup is symmetric', () => {
    for (const code of Object.keys(ERROR_CODE_SPECS)) {
      expect(ERROR_CODE_SPECS[code as keyof typeof ERROR_CODE_SPECS]?.code).toBe(code);
    }
  });
});

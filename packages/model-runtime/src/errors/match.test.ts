import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isUserSideError, matchErrorPattern } from './match';
import { ERROR_CODE_SPECS, formatErrorRef, parseErrorRef } from './specs';
import { CATEGORY_NUMERIC_PREFIX } from './taxonomy';

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
      AgentRuntimeErrorType.RateLimitExceeded,
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
    expect(isUserSideError(AgentRuntimeErrorType.RateLimitExceeded)).toBe(true);
    expect(isUserSideError(AgentRuntimeErrorType.ExceededContextWindow)).toBe(true);
  });

  it('resolves the deprecated QuotaLimitReached alias to RateLimitExceeded spec', () => {
    expect(isUserSideError(AgentRuntimeErrorType.QuotaLimitReached)).toBe(true);
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

describe('numericId contract', () => {
  const specs = Object.values(ERROR_CODE_SPECS).filter((spec) => spec !== undefined);

  it('every spec has a 4-digit numericId', () => {
    for (const spec of specs) {
      expect(spec.numericId).toBeGreaterThanOrEqual(1000);
      expect(spec.numericId).toBeLessThanOrEqual(9999);
    }
  });

  it('numericIds are globally unique', () => {
    const ids = specs.map((s) => s.numericId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leading digit matches category prefix', () => {
    for (const spec of specs) {
      const expectedPrefix = CATEGORY_NUMERIC_PREFIX[spec.category];
      const actualPrefix = Math.floor(spec.numericId / 1000);
      expect(
        actualPrefix,
        `${spec.code} (category=${spec.category}) has numericId ${spec.numericId} — expected prefix ${expectedPrefix}`,
      ).toBe(expectedPrefix);
    }
  });

  it('spec entries appear in source order sorted by numericId', () => {
    // JS object keys preserve insertion order — this guard prevents future
    // additions from being wedged into the wrong section.
    const ids = specs.map((s) => s.numericId);
    const sortedIds = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sortedIds);
  });
});

describe('formatErrorRef / parseErrorRef', () => {
  it('formats known code as Exxxx', () => {
    expect(formatErrorRef(AgentRuntimeErrorType.InvalidProviderAPIKey)).toBe('E1001');
    expect(formatErrorRef(AgentRuntimeErrorType.RateLimitExceeded)).toBe('E3001');
    expect(formatErrorRef(AgentRuntimeErrorType.OperationInactivityTimeout)).toBe('E7002');
  });

  it('resolves the deprecated QuotaLimitReached alias via the spec', () => {
    expect(formatErrorRef(AgentRuntimeErrorType.QuotaLimitReached)).toBe('E3001');
  });

  it('returns undefined for unknown / empty code', () => {
    expect(formatErrorRef(undefined)).toBeUndefined();
    expect(formatErrorRef('NotARealCode')).toBeUndefined();
  });

  it('parseErrorRef inverts formatErrorRef', () => {
    expect(parseErrorRef('E1001')).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(parseErrorRef('E3001')).toBe(AgentRuntimeErrorType.RateLimitExceeded);
  });

  it('parseErrorRef rejects malformed input', () => {
    expect(parseErrorRef(undefined)).toBeUndefined();
    expect(parseErrorRef('')).toBeUndefined();
    expect(parseErrorRef('1001')).toBeUndefined();
    expect(parseErrorRef('E10')).toBeUndefined();
    expect(parseErrorRef('E99999')).toBeUndefined();
    expect(parseErrorRef('E9999')).toBeUndefined();
  });
});

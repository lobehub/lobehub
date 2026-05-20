import { describe, expect, it } from 'vitest';

import { getContentPolicyErrorMessage } from './contentPolicyError';

describe('getContentPolicyErrorMessage', () => {
  it('should return a generic message for known content policy codes', () => {
    expect(getContentPolicyErrorMessage({ code: 'content_policy_violation' })).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
    expect(getContentPolicyErrorMessage({ error: { code: 'moderation_blocked' } })).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
    expect(getContentPolicyErrorMessage({ code: 'InputTextSensitiveContentDetected' })).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
  });

  it('should return a generic message for known content policy text', () => {
    expect(getContentPolicyErrorMessage({ message: 'Blocked by content policy.' })).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
    expect(
      getContentPolicyErrorMessage({
        error: { message: 'Your request was rejected by the safety system.' },
      }),
    ).toBe('Content policy check failed. Revise your prompt and try again.');
    expect(getContentPolicyErrorMessage({ message: 'Input contains sensitive information.' })).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
  });

  it('should return undefined for unrelated provider errors', () => {
    expect(getContentPolicyErrorMessage({ code: 'rate_limit_exceeded' })).toBeUndefined();
    expect(getContentPolicyErrorMessage({ message: 'Network timeout' })).toBeUndefined();
  });
});

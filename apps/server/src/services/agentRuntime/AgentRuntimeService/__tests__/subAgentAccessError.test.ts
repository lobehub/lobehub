import { normalizeChatMessageError } from '@lobechat/model-runtime/errors';
import { describe, expect, it } from 'vitest';

import { formatSubAgentErrorReason } from '../utils';

describe('formatSubAgentErrorReason for a usage-security refusal', () => {
  const thrown = {
    _responseBody: { provider: 'lobehub', reason: 'not_onboarded' },
    error: { message: 403 },
    errorType: 403,
    message: 'Request blocked.',
    provider: 'lobehub',
  };

  it.each([
    ['as thrown by the gate', thrown],
    ['as stored on the failed run', normalizeChatMessageError(thrown)],
  ])('names the reason and rules out the prompt %s', (_label, error) => {
    const reason = formatSubAgentErrorReason(error);

    expect(reason).toContain('blocked by a LobeHub account check (not_onboarded)');
    expect(reason).toContain('has not finished onboarding');
    expect(reason).toContain('not a verdict on the prompt');
  });

  it('does not claim onboarding for another gate reason', () => {
    const reason = formatSubAgentErrorReason({
      body: { reason: 'user_banned' },
      message: 'Request blocked.',
      type: 403,
    });

    expect(reason).toContain('(user_banned)');
    expect(reason).not.toContain('onboarding');
  });

  it('keeps the plain message for a 403 without a gate reason', () => {
    expect(
      formatSubAgentErrorReason({
        body: { provider: 'lobehub' },
        message: 'Request blocked.',
        type: 403,
      }),
    ).toBe('Request blocked.');
  });

  it('ignores a reason on an error that is not a 403', () => {
    expect(
      formatSubAgentErrorReason({
        body: { reason: 'not_onboarded' },
        message: 'Upstream failed',
        type: 500,
      }),
    ).toBe('Upstream failed');
  });
});

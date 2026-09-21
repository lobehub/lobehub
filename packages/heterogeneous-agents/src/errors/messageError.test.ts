import { describe, expect, it } from 'vitest';

import { normalizeHeterogeneousMessageError, readHeterogeneousErrorContext } from './messageError';

describe('heterogeneous message errors', () => {
  it('recovers a flattened weekly limit for local and remote callers', () => {
    const result = normalizeHeterogeneousMessageError(
      {
        type: 'AgentRuntimeError',
        message: "You've hit your weekly limit · resets 10pm (Asia/Shanghai)",
      },
      'claude-code',
    );
    expect(result).toMatchObject({
      errorRef: 'H2001',
      attribution: 'user',
      retryable: false,
      body: { agentType: 'claude-code', code: 'rate_limit', details: { kind: 'usage_limit' } },
    });
    expect(normalizeHeterogeneousMessageError(result)).toEqual(result);
  });
  it('does not classify temporary throttling as exhausted quota', () => {
    const error = {
      type: 'AgentRuntimeError' as const,
      message: 'Server is temporarily limiting requests (not your usage limit)',
    };
    expect(normalizeHeterogeneousMessageError(error, 'claude-code')).toBe(error);
  });
  it('projects only safe quota context and rejects an allowed window', () => {
    const error = {
      type: 'AgentRuntimeError' as const,
      body: {
        agentType: 'claude-code',
        code: 'rate_limit',
        details: { kind: 'usage_limit' },
        stderr: '/private/key secret',
        rateLimitInfo: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1789826400 },
      },
    };
    expect(readHeterogeneousErrorContext(error)).toEqual({
      agentType: 'claude-code',
      kind: 'usage_limit',
      rateLimitType: 'seven_day',
      resetsAt: 1789826400,
    });
    error.body.rateLimitInfo.status = 'allowed';
    expect(readHeterogeneousErrorContext(error)).toEqual({
      agentType: 'claude-code',
      kind: 'usage_limit',
    });
  });
  it('does not attach a quota reset to network failures or credits', () => {
    for (const kind of ['network_drop', 'credit_limit']) {
      const result = readHeterogeneousErrorContext({
        type: 'AgentRuntimeError',
        body: {
          agentType: 'claude-code',
          details: { kind },
          rateLimitInfo: { status: 'rejected', resetsAt: 1789826400 },
        },
      });
      expect(result).toEqual({ agentType: 'claude-code', kind });
    }
  });
});

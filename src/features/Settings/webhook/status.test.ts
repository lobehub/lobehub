import { describe, expect, it } from 'vitest';

import { formatSecretHint, resolveEndpointStatus, resolveTestOutcome } from './status';

describe('resolveEndpointStatus', () => {
  it('tells an auto-disabled endpoint from one its owner paused', () => {
    expect(
      resolveEndpointStatus({
        consecutiveFailures: 5,
        disabledReason: 'consecutive_failures',
        enabled: false,
      }),
    ).toBe('autoDisabled');
    expect(
      resolveEndpointStatus({ consecutiveFailures: 0, disabledReason: 'manual', enabled: false }),
    ).toBe('paused');
  });

  it('flags an enabled endpoint whose recent deliveries failed', () => {
    expect(
      resolveEndpointStatus({ consecutiveFailures: 2, disabledReason: null, enabled: true }),
    ).toBe('failing');
    expect(
      resolveEndpointStatus({ consecutiveFailures: 0, disabledReason: null, enabled: true }),
    ).toBe('active');
  });
});

describe('formatSecretHint', () => {
  it('masks all but the hint', () => {
    expect(formatSecretHint('abcd')).toBe('whsec_…abcd');
  });
});

describe('resolveTestOutcome', () => {
  it('reports success only for a delivered attempt', () => {
    expect(
      resolveTestOutcome({ durationMs: 42, error: null, responseStatus: 200, status: 'succeeded' }),
    ).toEqual({ durationMs: 42, error: null, ok: true, responseStatus: 200 });
    expect(
      resolveTestOutcome({
        durationMs: 10,
        error: 'HTTP 500',
        responseStatus: 500,
        status: 'failed',
      }).ok,
    ).toBe(false);
  });
});

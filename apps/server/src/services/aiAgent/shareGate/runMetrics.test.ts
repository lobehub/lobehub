// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeShareRunErrorType, recordShareRunResult } from './runMetrics';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@lobechat/observability-otel/modules/agent-share', () => ({
  agentShareRunCounter: { add },
}));

describe('share run metrics', () => {
  beforeEach(() => add.mockReset());

  it('keeps known error types and folds free-text ones into a closed set', () => {
    expect(normalizeShareRunErrorType('ShareSpendLimitExceeded')).toBe('ShareSpendLimitExceeded');
    expect(normalizeShareRunErrorType('ProviderBizError')).toBe('ProviderBizError');
    expect(normalizeShareRunErrorType('rate limit hit for org_123')).toBe('Other');
    expect(normalizeShareRunErrorType(undefined)).toBe('Unknown');
    expect(normalizeShareRunErrorType('')).toBe('Unknown');
  });

  it('labels a success with no error', () => {
    recordShareRunResult({ errorType: 'ProviderBizError', outcome: 'success', stage: 'run' });

    expect(add).toHaveBeenCalledWith(1, {
      error_attribution: 'none',
      error_type: 'none',
      outcome: 'success',
      stage: 'run',
    });
  });

  it('labels a failure by its type and attribution', () => {
    recordShareRunResult({
      attribution: 'provider',
      errorType: 'ProviderBizError',
      outcome: 'error',
      stage: 'run',
    });

    expect(add).toHaveBeenCalledWith(1, {
      error_attribution: 'provider',
      error_type: 'ProviderBizError',
      outcome: 'error',
      stage: 'run',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';

import { getGenerationStatusPollingInterval } from './generationStatusPolling';

describe('getGenerationStatusPollingInterval', () => {
  it.each([AsyncTaskStatus.Success, AsyncTaskStatus.Error])(
    'stops polling once the task is %s',
    (status) => {
      expect(getGenerationStatusPollingInterval({ hasError: false, requestCount: 3, status })).toBe(
        0,
      );
    },
  );

  it.each([
    [0, 1000],
    [4, 1000],
    [5, 2000],
    [10, 4000],
    [15, 5000],
    [100, 5000],
  ])('after %i requests polls every %ims', (requestCount, expected) => {
    expect(
      getGenerationStatusPollingInterval({
        hasError: false,
        requestCount,
        status: AsyncTaskStatus.Processing,
      }),
    ).toBe(expected);
  });

  it('keeps long-running tasks within 5s of completion instead of 30s', () => {
    expect(getGenerationStatusPollingInterval({ hasError: false, requestCount: 40 })).toBe(5000);
  });

  it('backs off further after a failed status request', () => {
    expect(getGenerationStatusPollingInterval({ hasError: true, requestCount: 0 })).toBe(2000);
    expect(getGenerationStatusPollingInterval({ hasError: true, requestCount: 100 })).toBe(10_000);
  });
});

import { describe, expect, it } from 'vitest';

import { getThreadExecutionStepCount } from './ThreadExecutionSummary';

describe('getThreadExecutionStepCount', () => {
  it('shows one execution step before tool-call totals settle', () => {
    expect(getThreadExecutionStepCount()).toBe(1);
  });

  it('counts each tool call plus the final response step', () => {
    expect(getThreadExecutionStepCount(2)).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';

import { isGoalArchiveBlocked } from './goalArchive';

describe('isGoalArchiveBlocked', () => {
  it('lets a completed or canceled goal be archived', () => {
    expect(isGoalArchiveBlocked({ status: 'achieved' })).toBe(false);
    expect(isGoalArchiveBlocked({ status: 'canceled' })).toBe(false);
  });

  it('blocks a failed, draft or open goal', () => {
    for (const status of [
      'failed',
      'draft',
      'planning',
      'running',
      'verifying',
      'review',
      'paused',
    ])
      expect(isGoalArchiveBlocked({ status })).toBe(true);
  });
});

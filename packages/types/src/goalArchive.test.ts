import { describe, expect, it } from 'vitest';

import { isGoalArchiveBlocked } from './goalArchive';

describe('isGoalArchiveBlocked', () => {
  it('lets a signed-off or canceled goal be archived', () => {
    expect(isGoalArchiveBlocked({ signedOff: true, status: 'achieved' })).toBe(false);
    expect(isGoalArchiveBlocked({ status: 'canceled' })).toBe(false);
  });

  it('blocks an achieved goal still waiting on its sign-off', () => {
    expect(isGoalArchiveBlocked({ signedOff: false, status: 'achieved' })).toBe(true);
    expect(isGoalArchiveBlocked({ status: 'achieved' })).toBe(true);
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
      expect(isGoalArchiveBlocked({ signedOff: true, status })).toBe(true);
  });
});

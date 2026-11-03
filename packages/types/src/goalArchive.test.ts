import { describe, expect, it } from 'vitest';

import { GOAL_ARCHIVABLE_STATUSES, isGoalArchiveBlocked } from './goalArchive';

describe('isGoalArchiveBlocked', () => {
  it('lets a draft or an ended goal be archived', () => {
    for (const status of GOAL_ARCHIVABLE_STATUSES) expect(isGoalArchiveBlocked(status)).toBe(false);
  });

  it('blocks every status in which the goal can still move on its own', () => {
    for (const status of ['planning', 'running', 'verifying', 'review', 'paused']) {
      expect(isGoalArchiveBlocked(status)).toBe(true);
    }
  });
});

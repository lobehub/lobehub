import { describe, expect, it } from 'vitest';

import { resolveHomeTopicSections } from './homeTopicSections';

describe('resolveHomeTopicSections', () => {
  it('shows every running topic once and removes it from recent topics', () => {
    const runningRecent = { id: 'running-recent', title: 'Running recent topic' };
    const recentOnly = { id: 'recent-only', title: 'Recent topic' };
    const runningOutsideRecentLimit = {
      id: 'running-outside-limit',
      title: 'Running topic outside the recent limit',
    };

    expect(
      resolveHomeTopicSections(
        [runningRecent, recentOnly],
        [runningRecent, runningOutsideRecentLimit],
      ),
    ).toEqual({
      recent: [recentOnly],
      running: [runningRecent, runningOutsideRecentLimit],
    });
  });
});

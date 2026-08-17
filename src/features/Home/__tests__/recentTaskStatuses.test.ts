import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import { describe, expect, it } from 'vitest';

import { RECENT_TASK_STATUSES } from '../HomeModeContent';

// The recent block shows ongoing work: completed tasks are history for the
// Tasks page and stay out of Home.
describe('RECENT_TASK_STATUSES', () => {
  it('hides finished work from the recent block', () => {
    expect(RECENT_TASK_STATUSES).not.toContain('completed');
  });

  // Derived, not hand-listed: a status added to the canonical set later must
  // show up on Home by default instead of silently vanishing.
  it('keeps every other canonical status', () => {
    expect(RECENT_TASK_STATUSES).toEqual(TASK_STATUSES.filter((s) => s !== 'completed'));
    expect(RECENT_TASK_STATUSES).toHaveLength(TASK_STATUSES.length - 1);
  });
});

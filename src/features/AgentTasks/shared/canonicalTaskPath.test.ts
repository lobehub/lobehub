import { describe, expect, it } from 'vitest';

import { canonicalTaskPath } from './canonicalTaskPath';

describe('canonical task location', () => {
  it('uses the public identifier and preserves workspace, agent, query, and hash', () => {
    expect(
      canonicalTaskPath({
        taskRef: 'T-3',
        aid: 'agt_1',
        workspaceSlug: 'team',
        title: 'Ship it',
        search: '?tab=runs',
        hash: '#activity',
      }),
    ).toBe('/team/agent/agt_1/task/T-3/ship-it?tab=runs#activity');
  });
  it('supports a global task with an empty title', () => {
    expect(canonicalTaskPath({ taskRef: 'T-3', title: '', search: '', hash: '' })).toBe(
      '/task/T-3',
    );
  });
});

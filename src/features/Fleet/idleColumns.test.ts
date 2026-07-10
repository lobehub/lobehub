import { describe, expect, it } from 'vitest';

import { getIdleColumnKeys } from './idleColumns';
import type { FleetColumn } from './types';

const column = (key: string): FleetColumn => ({
  agentId: 'agent-1',
  fallbackTitle: key,
  key,
  threadId: null,
  topicId: key,
});

describe('getIdleColumnKeys', () => {
  it('does not classify persisted columns as idle while statuses are loading', () => {
    expect(
      getIdleColumnKeys({
        columns: [column('running-column')],
        isStatusLoading: true,
        statusByColumnKey: {},
      }),
    ).toEqual([]);
  });

  it('returns non-running columns after statuses have loaded', () => {
    expect(
      getIdleColumnKeys({
        columns: [column('running-column'), column('idle-column')],
        statusByColumnKey: { 'running-column': 'running' },
      }),
    ).toEqual(['idle-column']);
  });
});

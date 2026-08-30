import { describe, expect, it } from 'vitest';

import { decodeProjectionHydration, encodeProjectionCommit } from './codec';
import type { MaterializedProjectionCommit } from './types';

describe('Projection desktop codec', () => {
  it('round-trips every migrated entity kind, Home index, snapshot, and structured dates', () => {
    const updatedAt = new Date('2026-08-11T08:08:37.745Z');
    const commit: MaterializedProjectionCommit = {
      indexes: [
        {
          groups: [],
          key: 'home.sidebar',
          observedAt: 10,
          pinned: [{ id: 'agent-1', kind: 'agent', pinned: true, updatedAt }],
          privateGroups: [],
          privatePinned: [],
          privateUngrouped: [],
          source: 'network',
          ungrouped: [],
        },
      ],
      records: [
        {
          fragments: {
            identity: { data: { title: 'Agent' }, observedAt: 1, source: 'network' },
          },
          id: 'agent-1',
          kind: 'agent',
        },
        {
          fragments: {
            identity: { data: { title: 'Group' }, observedAt: 2, source: 'network' },
          },
          id: 'group-1',
          kind: 'chatGroup',
        },
        {
          fragments: {
            activity: { data: { updatedAt }, observedAt: 3, source: 'network' },
            display: { data: { title: 'Topic' }, observedAt: 3, source: 'network' },
          },
          id: 'topic-1',
          kind: 'topic',
        },
        {
          fragments: {
            lifecycle: { data: { status: 'backlog' }, observedAt: 4, source: 'network' },
          },
          id: 'task-1',
          kind: 'task',
        },
        {
          fragments: {
            readState: { data: { readAt: null }, observedAt: 5, source: 'network' },
          },
          id: 'brief-1',
          kind: 'brief',
        },
      ],
      snapshots: [
        {
          data: { pairs: [{ hint: 'Hint', welcome: 'Welcome' }] },
          key: 'home.dailyBrief',
          observedAt: 10,
          source: 'network',
        },
      ],
    };

    const encoded = encodeProjectionCommit('user-1:personal', commit);
    const hydration = {
      indexes: encoded.indexes ?? [],
      records: encoded.records ?? [],
      snapshots: encoded.snapshots ?? [],
    };
    expect(decodeProjectionHydration(hydration)).toEqual(commit);
    expect(
      (
        decodeProjectionHydration(hydration).indexes[0] as Extract<
          (typeof commit.indexes)[number],
          { key: 'home.sidebar' }
        >
      ).pinned[0].updatedAt,
    ).toBeInstanceOf(Date);
  });

  it('drops malformed persisted rows instead of failing the entire scope hydration', () => {
    expect(
      decodeProjectionHydration({
        indexes: [],
        records: [
          {
            fragments: {
              display: { data: '{invalid', observedAt: 1, source: 'network' },
            },
            id: 'topic-1',
            kind: 'topic',
          },
        ],
        snapshots: [],
      }),
    ).toEqual({ indexes: [], records: [], snapshots: [] });
  });
});

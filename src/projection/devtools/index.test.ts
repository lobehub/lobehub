import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyProjectionCellEdit,
  applyProjectionFragmentEdit,
  parseProjectionCellDraft,
  serializeProjectionCellDraft,
} from './index';
import type { ManagedProjection } from './managedProjection';

const mocks = vi.hoisted(() => ({ getProjectionStoreState: vi.fn() }));

vi.mock('../store', () => ({ getProjectionStoreState: mocks.getProjectionStoreState }));

const projection: ManagedProjection = {
  entryKey: 'user-1%3Apersonal::topic::topic-1',
  record: {
    fragments: {
      display: { data: { title: 'Persisted' }, observedAt: 50, source: 'network' },
    },
    id: 'topic-1',
    kind: 'topic',
  },
  scope: 'user-1:personal',
};

describe('Projection devtool edits', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits a mutation newer than both the persisted row and live Store fragment', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          records: {
            topic: {
              'topic-1': {
                fragments: {
                  display: { data: { title: 'Live' }, observedAt: 200, source: 'realtime' },
                },
                id: 'topic-1',
                kind: 'topic',
              },
            },
          },
        },
      },
    });

    await expect(
      applyProjectionFragmentEdit({
        data: { title: 'Edited' },
        fragmentName: 'display',
        projection,
      }),
    ).resolves.toMatchObject({
      fragments: {
        display: { data: { title: 'Edited' }, observedAt: 201, source: 'mutation' },
      },
    });
    expect(commit).toHaveBeenCalledWith('user-1:personal', {
      records: [
        {
          fragments: {
            display: { data: { title: 'Edited' }, observedAt: 201, source: 'mutation' },
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
    });
  });

  it('patches a nested fragment field against the latest live fragment', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          records: {
            topic: {
              'topic-1': {
                fragments: {
                  display: {
                    data: {
                      concurrent: 'preserved',
                      profile: { enabled: true, title: 'Live title' },
                    },
                    observedAt: 200,
                    source: 'realtime',
                  },
                },
                id: 'topic-1',
                kind: 'topic',
              },
            },
          },
        },
      },
    });

    await applyProjectionCellEdit({
      target: {
        fragmentName: 'display',
        path: ['profile', 'title'],
        projection,
        type: 'fragment',
      },
      value: 'Edited title',
    });

    expect(commit).toHaveBeenCalledWith('user-1:personal', {
      records: [
        {
          fragments: {
            display: {
              data: {
                concurrent: 'preserved',
                profile: { enabled: true, title: 'Edited title' },
              },
              observedAt: 201,
              source: 'mutation',
            },
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
    });
  });

  it('rejects a nested edit when its live property no longer exists', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          records: {
            topic: {
              'topic-1': {
                fragments: {
                  display: { data: { title: 'Live' }, observedAt: 200, source: 'realtime' },
                },
                id: 'topic-1',
                kind: 'topic',
              },
            },
          },
        },
      },
    });

    await expect(
      applyProjectionCellEdit({
        target: {
          fragmentName: 'display',
          path: ['profile', 'title'],
          projection,
          type: 'fragment',
        },
        value: 'Edited title',
      }),
    ).rejects.toThrow('Object property “profile” is no longer available.');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits an index field through the same live Store and persistence boundary', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          indexes: {
            'home.tasks': {
              key: 'home.tasks',
              observedAt: 200,
              refs: [{ id: 'task-1', kind: 'task' }],
              source: 'network',
              total: 1,
            },
          },
          snapshots: {},
        },
      },
    });

    await expect(
      applyProjectionCellEdit({
        target: {
          fieldName: 'total',
          key: 'home.tasks',
          scope: 'user-1:personal',
          type: 'index',
        },
        value: 2,
      }),
    ).resolves.toMatchObject({ observedAt: 201, source: 'mutation', total: 2 });
    expect(commit).toHaveBeenCalledWith('user-1:personal', {
      indexes: [
        {
          key: 'home.tasks',
          observedAt: 201,
          refs: [{ id: 'task-1', kind: 'task' }],
          source: 'mutation',
          total: 2,
        },
      ],
    });
  });

  it('rejects an invalid index field before committing it', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          indexes: {
            'home.tasks': {
              key: 'home.tasks',
              observedAt: 200,
              refs: [],
              source: 'network',
              total: 1,
            },
          },
          snapshots: {},
        },
      },
    });

    await expect(
      applyProjectionCellEdit({
        target: {
          fieldName: 'total',
          key: 'home.tasks',
          scope: 'user-1:personal',
          type: 'index',
        },
        value: -1,
      }),
    ).rejects.toThrow('does not match the schema');
    expect(commit).not.toHaveBeenCalled();
  });

  it('preserves typed sidebar dates when an index array is edited as JSON', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const sidebarIndex = {
      groups: [],
      key: 'home.sidebar',
      observedAt: 200,
      pinned: [],
      privateGroups: [],
      privatePinned: [],
      privateUngrouped: [],
      source: 'network',
      ungrouped: [],
    };
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          indexes: { 'home.sidebar': sidebarIndex },
          snapshots: {},
        },
      },
    });

    await applyProjectionCellEdit({
      target: {
        fieldName: 'pinned',
        key: 'home.sidebar',
        scope: 'user-1:personal',
        type: 'index',
      },
      value: [
        {
          id: 'agent-1',
          kind: 'agent',
          pinned: true,
          updatedAt: '2026-08-11T00:00:00.000Z',
        },
      ],
    });

    const edited = commit.mock.calls[0][1].indexes[0];
    expect(edited.pinned[0].updatedAt).toBeInstanceOf(Date);
    expect(edited.pinned[0].updatedAt.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('commits snapshot data cells through the snapshot collection', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          indexes: {},
          snapshots: {
            'home.dailyBrief': {
              data: { pairs: [{ hint: 'Initial hint', welcome: 'Initial welcome' }] },
              key: 'home.dailyBrief',
              observedAt: 200,
              source: 'network',
            },
          },
        },
      },
    });

    await applyProjectionCellEdit({
      target: {
        fieldName: 'data',
        key: 'home.dailyBrief',
        scope: 'user-1:personal',
        type: 'snapshot',
      },
      value: { pairs: [{ hint: 'Edited hint', welcome: 'Edited welcome' }] },
    });

    expect(commit).toHaveBeenCalledWith('user-1:personal', {
      snapshots: [
        {
          data: { pairs: [{ hint: 'Edited hint', welcome: 'Edited welcome' }] },
          key: 'home.dailyBrief',
          observedAt: 201,
          source: 'mutation',
        },
      ],
    });
  });

  it('patches an array item inside snapshot data without replacing its siblings', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    mocks.getProjectionStoreState.mockReturnValue({
      internal_commitProjectionForDevtools: commit,
      scopes: {
        'user-1:personal': {
          indexes: {},
          snapshots: {
            'home.dailyBrief': {
              data: { pairs: [{ hint: 'Initial hint', welcome: 'Keep welcome' }] },
              key: 'home.dailyBrief',
              observedAt: 200,
              source: 'network',
            },
          },
        },
      },
    });

    await applyProjectionCellEdit({
      target: {
        fieldName: 'data',
        key: 'home.dailyBrief',
        path: ['pairs', 0, 'hint'],
        scope: 'user-1:personal',
        type: 'snapshot',
      },
      value: 'Edited hint',
    });

    expect(commit).toHaveBeenCalledWith('user-1:personal', {
      snapshots: [
        {
          data: { pairs: [{ hint: 'Edited hint', welcome: 'Keep welcome' }] },
          key: 'home.dailyBrief',
          observedAt: 201,
          source: 'mutation',
        },
      ],
    });
  });

  it('uses typed drafts for scalar and structured cells', () => {
    expect(serializeProjectionCellDraft({ title: 'Initial' })).toBe('{"title":"Initial"}');
    expect(serializeProjectionCellDraft({ title: 'Initial' }, true)).toBe(
      '{\n  "title": "Initial"\n}',
    );
    expect(parseProjectionCellDraft('{"title":"Edited"}', { title: 'Initial' })).toEqual({
      title: 'Edited',
    });
    expect(parseProjectionCellDraft('team', 'mine')).toBe('team');
    expect(parseProjectionCellDraft('2', 1)).toBe(2);
    expect(serializeProjectionCellDraft(undefined)).toBe('undefined');
    expect(parseProjectionCellDraft('"defined"', undefined)).toBe('defined');
    expect(() => parseProjectionCellDraft('{', {})).toThrow('must be valid JSON');
  });
});

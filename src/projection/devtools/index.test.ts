import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyProjectionFragmentEdit } from './index';
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

describe('applyProjectionFragmentEdit', () => {
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
});

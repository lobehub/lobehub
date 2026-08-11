import type { TopicProjection } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreSetter } from '@/store/types';

import type { ProjectionPersistence } from '../persistence/types';
import type { ProjectionStore } from '../store';
import { createProjectionCoreAction } from './action';
import { createEmptyProjectionScope } from './initialState';
import { applyProjectionCommit } from './reducer';

const mocks = vi.hoisted(() => ({ scopeTrusted: true }));

vi.mock('@/libs/swr/useCacheScope', () => ({
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => mocks.scopeTrusted,
}));

const SCOPE = 'user-1:personal';

const initialTopic: TopicProjection = {
  fragments: {
    display: { data: { title: 'Initial' }, observedAt: 10, source: 'network' },
    status: { data: { status: 'running' }, observedAt: 20, source: 'realtime' },
  },
  id: 'topic-1',
  kind: 'topic',
};

const editedTopic = (title: string): TopicProjection => ({
  fragments: {
    display: { data: { title }, observedAt: 30, source: 'mutation' },
  },
  id: 'topic-1',
  kind: 'topic',
});

const createActionHarness = (persistence: ProjectionPersistence) => {
  let state = {
    scopes: {
      [SCOPE]: applyProjectionCommit(createEmptyProjectionScope('ready'), {
        records: [initialTopic],
      }),
    },
  } as unknown as ProjectionStore;

  const set: StoreSetter<ProjectionStore> = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = replace ? (next as ProjectionStore) : ({ ...state, ...next } as ProjectionStore);
  };
  const action = createProjectionCoreAction(persistence, set, () => state);
  state = { ...state, ...action };

  return { getState: () => state };
};

describe('ProjectionCoreAction', () => {
  beforeEach(() => {
    mocks.scopeTrusted = true;
  });

  it('updates the live Store synchronously and persists the merged Projection exactly once', async () => {
    let releasePersistence!: () => void;
    const persistencePending = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const commit = vi.fn(() => persistencePending);
    const harness = createActionHarness({
      clearScope: vi.fn(),
      commit,
      hydrateScope: vi.fn(),
    });

    const pending = harness
      .getState()
      .internal_commitProjectionForDevtools(SCOPE, { records: [editedTopic('Edited')] });

    expect(
      harness.getState().scopes[SCOPE].records.topic['topic-1'].fragments.display?.data,
    ).toEqual({ title: 'Edited' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(SCOPE, {
      records: [
        {
          fragments: {
            display: { data: { title: 'Edited' }, observedAt: 30, source: 'mutation' },
            status: { data: { status: 'running' }, observedAt: 20, source: 'realtime' },
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      indexes: [],
      snapshots: [],
    });

    let persisted = false;
    void pending.then(() => {
      persisted = true;
    });
    await Promise.resolve();
    expect(persisted).toBe(false);

    releasePersistence();
    await expect(pending).resolves.toBeUndefined();
  });

  it('honors an explicit DevTool scope without changing business persistence guards', async () => {
    mocks.scopeTrusted = false;
    const commit = vi.fn().mockResolvedValue(undefined);
    const harness = createActionHarness({ clearScope: vi.fn(), commit, hydrateScope: vi.fn() });

    await harness
      .getState()
      .internal_commitProjectionForDevtools(SCOPE, { records: [editedTopic('Explicit')] });

    expect(
      harness.getState().scopes[SCOPE].records.topic['topic-1'].fragments.display?.data,
    ).toEqual({ title: 'Explicit' });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('surfaces persistence failures after retaining the visible Store edit', async () => {
    const failure = new Error('database unavailable');
    const harness = createActionHarness({
      clearScope: vi.fn(),
      commit: vi.fn().mockRejectedValue(failure),
      hydrateScope: vi.fn(),
    });

    await expect(
      harness
        .getState()
        .internal_commitProjectionForDevtools(SCOPE, { records: [editedTopic('Visible')] }),
    ).rejects.toThrow(
      'The live Projection Store was updated, but local database persistence failed: database unavailable',
    );

    const record = harness.getState().scopes[SCOPE].records.topic['topic-1'];
    expect(record.fragments.display?.data).toEqual({ title: 'Visible' });
  });
});

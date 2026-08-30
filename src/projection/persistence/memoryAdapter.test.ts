import type { ProjectionIndex, ProjectionRecord, ProjectionSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createMemoryProjectionPersistence } from './memoryAdapter';

const scope = 'user-1:workspace-1';
const record = (title: string, observedAt = 1): ProjectionRecord => ({
  fragments: { display: { data: { title }, observedAt, source: 'network' } },
  id: 'topic-1',
  kind: 'topic',
});
const index: ProjectionIndex = {
  key: 'home.inboxTopics',
  observedAt: 1,
  refs: [{ id: 'topic-1', kind: 'topic' }],
  source: 'network',
};
const snapshot: ProjectionSnapshot = {
  data: { pairs: [{ hint: 'Cached hint', welcome: 'Cached welcome' }] },
  key: 'home.dailyBrief',
  observedAt: 1,
  source: 'network',
};

describe('createMemoryProjectionPersistence', () => {
  it('hydrates only the indexes, records, and fragments declared by the view request', async () => {
    const persistence = createMemoryProjectionPersistence();

    await persistence.commit(scope, {
      indexes: [index],
      records: [record('Initial')],
      snapshots: [snapshot],
    });

    await expect(
      persistence.hydrate(scope, {
        indexes: ['home.inboxTopics'],
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
        snapshots: ['home.dailyBrief'],
      }),
    ).resolves.toEqual({
      indexes: [index],
      records: [record('Initial')],
      snapshots: [snapshot],
    });
  });

  it('replaces materialized entities by identity while isolating scopes', async () => {
    const persistence = createMemoryProjectionPersistence();
    await persistence.commit(scope, { indexes: [], records: [record('Older')], snapshots: [] });
    await persistence.commit(scope, { indexes: [], records: [record('Newer', 2)], snapshots: [] });
    await persistence.commit('user-1:workspace-2', {
      indexes: [],
      records: [record('Other scope')],
      snapshots: [],
    });

    await expect(
      persistence.hydrate(scope, {
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
      }),
    ).resolves.toMatchObject({
      records: [{ fragments: { display: { data: { title: 'Newer' } } } }],
    });
    await expect(
      persistence.hydrate('user-1:workspace-2', {
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
      }),
    ).resolves.toMatchObject({
      records: [{ fragments: { display: { data: { title: 'Other scope' } } } }],
    });
  });

  it('preserves structured values and clears only the requested scope', async () => {
    const persistence = createMemoryProjectionPersistence();
    const updatedAt = new Date('2026-08-11T00:00:00.000Z');
    const datedRecord: ProjectionRecord = {
      fragments: { activity: { data: { updatedAt }, observedAt: 1, source: 'network' } },
      id: 'topic-1',
      kind: 'topic',
    };
    await persistence.commit(scope, { indexes: [], records: [datedRecord], snapshots: [] });
    await persistence.commit('other', { indexes: [], records: [record('Other')], snapshots: [] });

    const hydrated = await persistence.hydrate(scope, {
      records: [{ fragments: ['activity'], ids: ['topic-1'], kind: 'topic' }],
    });
    expect(
      (hydrated.records[0].fragments as typeof datedRecord.fragments).activity?.data.updatedAt,
    ).toEqual(updatedAt);

    await persistence.clearScope(scope);
    await expect(
      persistence.hydrate(scope, {
        records: [{ fragments: ['activity'], ids: ['topic-1'], kind: 'topic' }],
      }),
    ).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
    });
    await expect(
      persistence.hydrate('other', {
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
      }),
    ).resolves.toMatchObject({
      records: [{ id: 'topic-1' }],
    });
  });

  it('merges fragment requirements for repeated requests of the same record', async () => {
    const persistence = createMemoryProjectionPersistence();
    const multiFragmentRecord: ProjectionRecord = {
      fragments: {
        activity: {
          data: { updatedAt: new Date('2026-08-11T00:00:00.000Z') },
          observedAt: 2,
          source: 'network',
        },
        display: { data: { title: 'Initial' }, observedAt: 1, source: 'network' },
      },
      id: 'topic-1',
      kind: 'topic',
    };
    await persistence.commit(scope, {
      indexes: [],
      records: [multiFragmentRecord],
      snapshots: [],
    });

    const hydrated = await persistence.hydrate(scope, {
      records: [
        { fragments: ['display'], ids: ['topic-1'], kind: 'topic' },
        { fragments: ['activity'], ids: ['topic-1'], kind: 'topic' },
      ],
    });

    expect(hydrated.records[0].fragments).toHaveProperty('display');
    expect(hydrated.records[0].fragments).toHaveProperty('activity');
    expect(hydrated.indexes).toEqual([]);
    expect(hydrated.snapshots).toEqual([]);
  });
});

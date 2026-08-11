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
  it('round-trips the complete materialized Projection graph without durable Web storage', async () => {
    const persistence = createMemoryProjectionPersistence();

    await persistence.commit(scope, {
      indexes: [index],
      records: [record('Initial')],
      snapshots: [snapshot],
    });

    await expect(persistence.hydrateScope(scope)).resolves.toEqual({
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

    await expect(persistence.hydrateScope(scope)).resolves.toMatchObject({
      records: [{ fragments: { display: { data: { title: 'Newer' } } } }],
    });
    await expect(persistence.hydrateScope('user-1:workspace-2')).resolves.toMatchObject({
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

    const hydrated = await persistence.hydrateScope(scope);
    expect(
      (hydrated.records[0].fragments as typeof datedRecord.fragments).activity?.data.updatedAt,
    ).toEqual(updatedAt);

    await persistence.clearScope(scope);
    await expect(persistence.hydrateScope(scope)).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
    });
    await expect(persistence.hydrateScope('other')).resolves.toMatchObject({
      records: [{ id: 'topic-1' }],
    });
  });
});

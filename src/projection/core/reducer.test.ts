import type { ProjectionSource, TopicProjection } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyProjectionCommit } from './reducer';

const topicFragment = (
  id: string,
  name: 'display' | 'status',
  data: Record<string, unknown>,
  observedAt: number,
  source: ProjectionSource,
): TopicProjection => ({
  fragments: { [name]: { data, observedAt, source } },
  id,
  kind: 'topic',
});

describe('applyProjectionCommit', () => {
  it('merges independently fetched fragments into one scoped Projection identity', () => {
    const withDisplay = applyProjectionCommit(undefined, {
      records: [topicFragment('topic-1', 'display', { title: 'Initial' }, 10, 'network')],
    });
    const withStatus = applyProjectionCommit(withDisplay, {
      records: [topicFragment('topic-1', 'status', { status: 'running' }, 20, 'realtime')],
    });

    expect(Object.keys(withStatus.records.topic)).toEqual(['topic-1']);
    expect(withStatus.records.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Initial',
    });
    expect(withStatus.records.topic['topic-1'].fragments.status?.data).toEqual({
      status: 'running',
    });
  });

  it('does not let an older request overwrite a newer mutation', () => {
    const mutated = applyProjectionCommit(undefined, {
      records: [topicFragment('topic-1', 'display', { title: 'Renamed' }, 200, 'mutation')],
    });
    const afterSlowResponse = applyProjectionCommit(mutated, {
      records: [topicFragment('topic-1', 'display', { title: 'Stale' }, 100, 'network')],
    });

    expect(afterSlowResponse.records.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Renamed',
    });
  });

  it('orders tombstones against Projection observations and prevents stale resurrection', () => {
    const current = applyProjectionCommit(undefined, {
      records: [
        topicFragment('topic-1', 'status', { status: 'running' }, 50, 'network'),
        topicFragment('topic-1', 'display', { title: 'Current' }, 200, 'mutation'),
      ],
    });

    const afterOlderDelete = applyProjectionCommit(current, {
      tombstones: [{ id: 'topic-1', kind: 'topic', observedAt: 100 }],
    });
    expect(afterOlderDelete.records.topic['topic-1'].tombstoneAt).toBeUndefined();
    expect(afterOlderDelete.records.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Current',
    });
    expect(afterOlderDelete.records.topic['topic-1'].fragments.status).toBeUndefined();

    const deleted = applyProjectionCommit(afterOlderDelete, {
      tombstones: [{ id: 'topic-1', kind: 'topic', observedAt: 300 }],
    });
    const afterStaleResponse = applyProjectionCommit(deleted, {
      records: [topicFragment('topic-1', 'display', { title: 'Stale' }, 250, 'network')],
    });
    expect(afterStaleResponse.records.topic['topic-1'].tombstoneAt).toBe(300);
    expect(afterStaleResponse.records.topic['topic-1'].fragments.display).toBeUndefined();

    const revived = applyProjectionCommit(afterStaleResponse, {
      records: [
        {
          fragments: {
            display: { data: { title: 'Recreated' }, observedAt: 400, source: 'network' },
            status: { data: { status: 'running' }, observedAt: 250, source: 'network' },
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
    });
    expect(revived.records.topic['topic-1'].tombstoneAt).toBeUndefined();
    expect(revived.records.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Recreated',
    });
    expect(revived.records.topic['topic-1'].fragments.status).toBeUndefined();
  });
});

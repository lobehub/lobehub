import type { EntitySource, TopicEntityRecord } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyClientDataCommit } from './reducer';

const topicFragment = (
  id: string,
  name: 'display' | 'status',
  data: Record<string, unknown>,
  observedAt: number,
  source: EntitySource,
): TopicEntityRecord => ({
  fragments: { [name]: { data, observedAt, source } },
  id,
  kind: 'topic',
});

describe('applyClientDataCommit', () => {
  it('merges independently fetched fragments into one scoped entity identity', () => {
    const withDisplay = applyClientDataCommit(undefined, {
      entities: [topicFragment('topic-1', 'display', { title: 'Initial' }, 10, 'network')],
    });
    const withStatus = applyClientDataCommit(withDisplay, {
      entities: [topicFragment('topic-1', 'status', { status: 'running' }, 20, 'realtime')],
    });

    expect(Object.keys(withStatus.entities.topic)).toEqual(['topic-1']);
    expect(withStatus.entities.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Initial',
    });
    expect(withStatus.entities.topic['topic-1'].fragments.status?.data).toEqual({
      status: 'running',
    });
  });

  it('does not let an older request overwrite a newer mutation', () => {
    const mutated = applyClientDataCommit(undefined, {
      entities: [topicFragment('topic-1', 'display', { title: 'Renamed' }, 200, 'mutation')],
    });
    const afterSlowResponse = applyClientDataCommit(mutated, {
      entities: [topicFragment('topic-1', 'display', { title: 'Stale' }, 100, 'network')],
    });

    expect(afterSlowResponse.entities.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Renamed',
    });
  });

  it('orders tombstones against entity observations and prevents stale resurrection', () => {
    const current = applyClientDataCommit(undefined, {
      entities: [
        topicFragment('topic-1', 'status', { status: 'running' }, 50, 'network'),
        topicFragment('topic-1', 'display', { title: 'Current' }, 200, 'mutation'),
      ],
    });

    const afterOlderDelete = applyClientDataCommit(current, {
      tombstones: [{ id: 'topic-1', kind: 'topic', observedAt: 100 }],
    });
    expect(afterOlderDelete.entities.topic['topic-1'].tombstoneAt).toBeUndefined();
    expect(afterOlderDelete.entities.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Current',
    });
    expect(afterOlderDelete.entities.topic['topic-1'].fragments.status).toBeUndefined();

    const deleted = applyClientDataCommit(afterOlderDelete, {
      tombstones: [{ id: 'topic-1', kind: 'topic', observedAt: 300 }],
    });
    const afterStaleResponse = applyClientDataCommit(deleted, {
      entities: [topicFragment('topic-1', 'display', { title: 'Stale' }, 250, 'network')],
    });
    expect(afterStaleResponse.entities.topic['topic-1'].tombstoneAt).toBe(300);
    expect(afterStaleResponse.entities.topic['topic-1'].fragments.display).toBeUndefined();

    const revived = applyClientDataCommit(afterStaleResponse, {
      entities: [
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
    expect(revived.entities.topic['topic-1'].tombstoneAt).toBeUndefined();
    expect(revived.entities.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Recreated',
    });
    expect(revived.entities.topic['topic-1'].fragments.status).toBeUndefined();
  });
});

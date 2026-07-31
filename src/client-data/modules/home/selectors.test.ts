import type {
  AgentEntityRecord,
  BriefItem,
  HomeRecentItem,
  SidebarAgentListResponse,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyClientDataCommit } from '../../core/reducer';
import {
  ingestHomeBriefs,
  ingestHomeInboxTopics,
  ingestHomeRecentTopics,
  ingestHomeSidebar,
} from './ingestors';
import {
  selectHomeBriefs,
  selectHomeInboxTopics,
  selectHomeRecentTopics,
  selectHomeSidebar,
} from './selectors';

const networkObservation = { observedAt: 100, source: 'network' as const };

const sidebarResponse: SidebarAgentListResponse = {
  groups: [],
  pinned: [
    {
      avatar: 'avatar.png',
      backgroundColor: '#fff',
      description: 'Description',
      heterogeneousType: null,
      id: 'agent-1',
      pinned: true,
      sessionId: 'session-1',
      slug: 'agent-one',
      title: 'Agent One',
      type: 'agent',
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      userId: 'user-1',
      visibility: 'public',
    },
  ],
  privateGroups: [],
  privatePinned: [],
  privateUngrouped: [],
  ungrouped: [],
};

const brief: BriefItem = {
  actions: null,
  agent: {
    avatar: 'avatar.png',
    backgroundColor: '#fff',
    id: 'agent-1',
    name: null,
    title: 'Agent One',
  },
  agentId: 'agent-1',
  artifacts: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  cronJobId: null,
  id: 'brief-1',
  priority: null,
  readAt: null,
  resolvedAction: null,
  resolvedAt: null,
  resolvedComment: null,
  summary: 'Summary',
  taskId: 'task-1',
  taskIdentifier: 'TASK-1',
  taskName: 'Task One',
  taskStatus: 'running',
  title: 'Brief One',
  topicId: 'topic-1',
  type: 'result',
  userId: 'user-1',
};

describe('Home EntityView selectors', () => {
  it('assembles a complete sidebar view from fragments and index references', () => {
    const scope = applyClientDataCommit(
      undefined,
      ingestHomeSidebar(sidebarResponse, networkObservation),
    );

    expect(selectHomeSidebar(scope)).toEqual(sidebarResponse);
  });

  it('does not expose a partial entity as a complete View Contract', () => {
    const scope = applyClientDataCommit(
      undefined,
      ingestHomeSidebar(sidebarResponse, networkObservation),
    );
    const record = scope.entities.agent['agent-1'];
    const { runtime: _runtime, ...incompleteFragments } = record.fragments;
    const incompleteScope = {
      ...scope,
      entities: {
        ...scope.entities,
        agent: {
          ...scope.entities.agent,
          'agent-1': { ...record, fragments: incompleteFragments },
        },
      },
    };

    expect(selectHomeSidebar(incompleteScope)).toBeUndefined();
  });

  it('updates every Brief enrichment through the single canonical Agent record', () => {
    const initial = applyClientDataCommit(undefined, ingestHomeBriefs([brief], networkObservation));
    const renamedAgent: AgentEntityRecord = {
      fragments: {
        identity: {
          data: { avatar: 'new.png', backgroundColor: '#000', title: 'Renamed Agent' },
          observedAt: 200,
          source: 'mutation',
        },
      },
      id: 'agent-1',
      kind: 'agent',
    };
    const updated = applyClientDataCommit(initial, { entities: [renamedAgent] });

    expect(selectHomeBriefs(initial)?.[0].agent?.title).toBe('Agent One');
    expect(selectHomeBriefs(updated)?.[0].agent).toEqual({
      avatar: 'new.png',
      backgroundColor: '#000',
      id: 'agent-1',
      name: null,
      title: 'Renamed Agent',
    });
  });

  it('represents fetched empty coverage as an initialized empty view', () => {
    const scope = applyClientDataCommit(undefined, ingestHomeInboxTopics([], networkObservation));

    expect(selectHomeInboxTopics(scope)).toEqual([]);
  });

  it('does not use a smaller recent-topic query to satisfy wider coverage', () => {
    const items: HomeRecentItem[] = [
      {
        agentId: 'agent-1',
        icon: 'topic',
        id: 'topic-1',
        routePath: '/chat/agent-1/topic/topic-1',
        status: null,
        title: 'Topic One',
        type: 'topic',
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      },
      {
        agentId: 'agent-1',
        icon: 'topic',
        id: 'topic-2',
        routePath: '/chat/agent-1/topic/topic-2',
        status: null,
        title: 'Topic Two',
        type: 'topic',
        updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      },
    ];
    const scope = applyClientDataCommit(
      undefined,
      ingestHomeRecentTopics(items, 2, 'mine', networkObservation),
    );

    expect(selectHomeRecentTopics(scope, 3)).toBeUndefined();
    expect(selectHomeRecentTopics(scope, 1)).toEqual([items[0]]);
  });

  it('filters a tombstoned entity from an older persisted index', () => {
    const initial = applyClientDataCommit(undefined, ingestHomeBriefs([brief], networkObservation));
    const deleted = applyClientDataCommit(initial, {
      tombstones: [{ id: brief.id, kind: 'brief', observedAt: 200 }],
    });

    expect(selectHomeBriefs(deleted)).toEqual([]);
  });
});

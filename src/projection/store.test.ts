import type { BriefItem, HomeTopicView, TaskListItem } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { selectHomeBriefs, selectHomeInboxTopics, selectHomeTasks } from './modules/home/selectors';
import { getProjectionStoreState, useProjectionStore } from './store';

const SCOPE = 'user-1:workspace-1';

const topic: HomeTopicView = {
  agentId: 'agent-1',
  id: 'topic-1',
  lastAssistantMessage: 'Working',
  runStartedAt: new Date('2026-07-31T00:00:00.000Z'),
  status: 'running',
  title: 'Topic One',
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  userId: 'user-1',
};

const task = {
  assigneeAgentId: 'agent-1',
  description: 'Task description',
  id: 'task-1',
  identifier: 'TASK-1',
  name: 'Task One',
  participants: [],
  status: 'backlog',
  visibility: 'public',
  workspaceId: 'workspace-1',
} as unknown as TaskListItem;

const brief: BriefItem = {
  actions: null,
  agent: null,
  agentId: null,
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
  taskId: null,
  title: 'Brief One',
  topicId: null,
  type: 'result',
  userId: 'user-1',
};

describe('ProjectionStore mutation paths', () => {
  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
  });

  it('publishes Topic status changes through the same Projection view', () => {
    getProjectionStoreState().ingestHomeInboxTopics(SCOPE, [topic], 100);
    getProjectionStoreState().updateTopicProjectionStatus(
      SCOPE,
      topic.id,
      'unread',
      'mutation',
      200,
    );

    expect(selectHomeInboxTopics(getProjectionStoreState().scopes[SCOPE])?.[0].status).toBe(
      'unread',
    );
  });

  it('resolves a Task identifier to one record before replacing its lifecycle fragment', () => {
    getProjectionStoreState().ingestHomeTasks(SCOPE, [task], 1, 100);
    getProjectionStoreState().updateTaskProjectionStatus(
      SCOPE,
      task.identifier,
      'running',
      'mutation',
      200,
    );

    expect(selectHomeTasks(getProjectionStoreState().scopes[SCOPE])?.[0].status).toBe('running');
  });

  it('updates Brief fragments and unresolved membership without patching SWR data', () => {
    getProjectionStoreState().ingestHomeBriefs(SCOPE, [brief], 100);
    getProjectionStoreState().updateBriefReadState(SCOPE, brief.id, '2026-07-31T01:00:00.000Z');

    expect(selectHomeBriefs(getProjectionStoreState().scopes[SCOPE])?.[0].readAt).toBe(
      '2026-07-31T01:00:00.000Z',
    );

    getProjectionStoreState().updateBriefResolution(SCOPE, brief.id, {
      resolvedAction: 'approve',
      resolvedAt: '2026-07-31T02:00:00.000Z',
      resolvedComment: null,
    });
    expect(selectHomeBriefs(getProjectionStoreState().scopes[SCOPE])).toEqual([]);
  });

  it('removes a deleted Topic from every canonical query index', () => {
    const ref = { id: topic.id, kind: 'topic' as const };
    getProjectionStoreState().internal_commitProjection(SCOPE, {
      indexes: [
        {
          key: 'chat.sidebarTopics:inbox',
          observedAt: 100,
          persistRefLimit: 20,
          refs: [ref],
          signature: {},
          source: 'network',
          total: 1,
        },
        { key: 'home.inboxTopics', observedAt: 100, refs: [ref], source: 'network' },
        {
          key: 'home.recentTopics',
          limit: 10,
          observedAt: 100,
          refs: [ref],
          source: 'network',
          view: 'mine',
        },
      ],
    });

    getProjectionStoreState().deleteChatTopicProjections(SCOPE, [topic.id], 200);
    const scope = getProjectionStoreState().scopes[SCOPE];

    expect(scope.indexes['chat.sidebarTopics:inbox']?.refs).toEqual([]);
    expect(scope.indexes['chat.sidebarTopics:inbox']?.total).toBe(0);
    expect(scope.indexes['home.inboxTopics']?.refs).toEqual([]);
    expect(scope.indexes['home.recentTopics']?.refs).toEqual([]);
    expect(scope.records.topic[topic.id].tombstoneAt).toBe(200);
  });

  it('removes deleted Agent and ChatGroup records from shared sidebar membership', () => {
    const agentRef = {
      id: 'agent-1',
      kind: 'agent' as const,
      pinned: true,
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const groupRef = {
      id: 'group-1',
      kind: 'chatGroup' as const,
      pinned: false,
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    getProjectionStoreState().internal_commitProjection(SCOPE, {
      indexes: [
        {
          groups: [{ id: 'folder', items: [groupRef], name: 'Folder', sort: 0 }],
          key: 'home.sidebar',
          observedAt: 100,
          pinned: [agentRef],
          privateGroups: [],
          privatePinned: [],
          privateUngrouped: [],
          source: 'network',
          ungrouped: [],
        },
        {
          key: 'agent.available',
          observedAt: 100,
          refs: [{ id: 'agent-1', kind: 'agent' }],
          signature: {},
          source: 'network',
        },
        {
          key: 'agent.directory',
          observedAt: 100,
          refs: [{ id: 'agent-1', kind: 'agent' }],
          signature: {},
          source: 'network',
        },
        {
          key: 'chatGroup.list',
          observedAt: 100,
          refs: [{ id: 'group-1', kind: 'chatGroup' }],
          source: 'network',
        },
      ],
    });

    getProjectionStoreState().deleteAgentProjection(SCOPE, 'agent-1', 200);
    getProjectionStoreState().deleteChatGroupProjection(SCOPE, 'group-1', 201);
    const scope = getProjectionStoreState().scopes[SCOPE];

    expect(scope.indexes['agent.available']?.refs).toEqual([]);
    expect(scope.indexes['agent.directory']?.refs).toEqual([]);
    expect(scope.indexes['chatGroup.list']?.refs).toEqual([]);
    expect(scope.indexes['home.sidebar']?.pinned).toEqual([]);
    expect(scope.indexes['home.sidebar']?.groups[0].items).toEqual([]);
  });

  it('removes topics cascade-deleted with an Agent or ChatGroup from Home indexes', () => {
    getProjectionStoreState().internal_commitProjection(SCOPE, {
      indexes: [
        {
          key: 'home.inboxTopics',
          observedAt: 100,
          refs: [
            { id: 'agent-topic', kind: 'topic' },
            { id: 'group-topic', kind: 'topic' },
          ],
          source: 'network',
        },
      ],
      records: [
        {
          fragments: {
            routing: { data: { agentId: 'agent-1' }, observedAt: 100, source: 'network' },
          },
          id: 'agent-topic',
          kind: 'topic',
        },
        {
          fragments: {
            routing: { data: { groupId: 'group-1' }, observedAt: 100, source: 'network' },
          },
          id: 'group-topic',
          kind: 'topic',
        },
      ],
    });

    getProjectionStoreState().deleteAgentProjection(SCOPE, 'agent-1', 200);
    getProjectionStoreState().deleteChatGroupProjection(SCOPE, 'group-1', 201);

    const scope = getProjectionStoreState().scopes[SCOPE];
    expect(scope.indexes['home.inboxTopics']?.refs).toEqual([]);
    expect(scope.records.topic['agent-topic'].tombstoneAt).toBe(200);
    expect(scope.records.topic['group-topic'].tombstoneAt).toBe(201);
  });

  it('removes deleted Task and Brief records from all migrated list indexes', () => {
    getProjectionStoreState().ingestHomeTasks(SCOPE, [task], 1, 100);
    getProjectionStoreState().commitTaskList(SCOPE, [task], 1, { visibility: 'all' }, 100);
    getProjectionStoreState().ingestHomeBriefs(SCOPE, [brief], 100);
    getProjectionStoreState().commitBriefNews(SCOPE, '2026-08-01', false, [brief], 100);

    getProjectionStoreState().deleteTaskProjection(SCOPE, task.identifier, 200);
    getProjectionStoreState().deleteBriefProjection(SCOPE, brief.id, 200);
    const scope = getProjectionStoreState().scopes[SCOPE];

    expect(scope.indexes['home.tasks']?.refs).toEqual([]);
    expect(scope.indexes['task.list:__none__:all']?.refs).toEqual([]);
    expect(scope.indexes['home.unresolvedBriefs']?.refs).toEqual([]);
    expect(scope.indexes['brief.news:2026-08-01']?.refs).toEqual([]);
  });
});

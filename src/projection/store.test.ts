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
});

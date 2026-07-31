import type {
  BriefEntityRecord,
  BriefItem,
  SidebarAgentItem,
  SidebarAgentListResponse,
  TaskListItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  ingestHomeBriefs,
  ingestHomeInboxTopics,
  ingestHomeSidebar,
  ingestHomeTasks,
} from './ingestors';

const networkObservation = { observedAt: 100, source: 'network' as const };

const sidebarAgent: SidebarAgentItem = {
  avatar: 'avatar.png',
  backgroundColor: '#fff',
  description: 'Agent description',
  id: 'agent-1',
  pinned: true,
  sessionId: 'session-1',
  slug: 'agent-one',
  title: 'Agent One',
  type: 'agent',
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  userId: 'user-1',
  visibility: 'public',
};

const brief: BriefItem = {
  actions: [{ key: 'approve', label: 'Approve', type: 'resolve' }],
  agent: {
    avatar: 'agent.png',
    backgroundColor: '#000',
    id: 'agent-1',
    name: null,
    title: 'Agent One',
  },
  agentId: 'agent-1',
  artifacts: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  cronJobId: null,
  id: 'brief-1',
  priority: 'high',
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
  type: 'decision',
  userId: 'user-1',
};

describe('Home entity ingestors', () => {
  it('deduplicates sidebar identities while preserving list membership as references', () => {
    const response: SidebarAgentListResponse = {
      groups: [],
      pinned: [sidebarAgent],
      privateGroups: [],
      privatePinned: [],
      privateUngrouped: [],
      ungrouped: [sidebarAgent],
    };

    const commit = ingestHomeSidebar(response, networkObservation);
    const index = commit.indexes?.[0];

    expect(commit.entities).toHaveLength(1);
    expect(index?.key).toBe('home.sidebar');
    if (index?.key !== 'home.sidebar') throw new Error('Expected Home sidebar index');
    expect(index.pinned[0]).toEqual({
      id: 'agent-1',
      kind: 'agent',
      pinned: true,
      updatedAt: sidebarAgent.updatedAt,
    });
    expect(index.pinned[0]).not.toHaveProperty('title');
    expect(index.ungrouped[0].id).toBe(index.pinned[0].id);
  });

  it('normalizes nested Brief enrichments into canonical Agent and Task records', () => {
    const commit = ingestHomeBriefs([brief], networkObservation);
    const records = new Map(
      commit.entities?.map((record) => [`${record.kind}:${record.id}`, record]),
    );
    const briefRecord = commit.entities?.find(
      (record): record is BriefEntityRecord => record.kind === 'brief' && record.id === 'brief-1',
    );

    expect(records.has('agent:agent-1')).toBe(true);
    expect(records.has('task:task-1')).toBe(true);
    expect(briefRecord?.fragments.relations?.data).toEqual({
      agentId: 'agent-1',
      cronJobId: null,
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(briefRecord?.fragments).not.toHaveProperty('agent');
    expect(briefRecord?.fragments).not.toHaveProperty('taskName');
  });

  it('rejects malformed Brief actions at the DTO boundary', () => {
    expect(() =>
      ingestHomeBriefs(
        [{ ...brief, actions: [{ key: 'approve', label: 'Approve', type: 'unsupported' }] }],
        networkObservation,
      ),
    ).toThrow('Invalid Brief actions payload');
  });

  it('rejects an unknown Brief type at the DTO boundary', () => {
    expect(() =>
      ingestHomeBriefs([{ ...brief, type: 'unknown-type' }], networkObservation),
    ).toThrow('Invalid Brief type payload');
  });

  it('rejects an unknown Task status at the DTO boundary', () => {
    const task = {
      assigneeAgentId: null,
      description: null,
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'Task One',
      participants: [],
      status: 'unknown-status',
      visibility: 'public',
      workspaceId: null,
    } as unknown as TaskListItem;

    expect(() => ingestHomeTasks([task], 1, networkObservation)).toThrow(
      'Invalid Task status payload',
    );
  });

  it('commits explicit empty coverage instead of treating an empty response as uninitialized', () => {
    const commit = ingestHomeInboxTopics([], networkObservation);

    expect(commit.entities).toEqual([]);
    expect(commit.indexes).toEqual([
      {
        key: 'home.inboxTopics',
        observedAt: 100,
        refs: [],
        source: 'network',
      },
    ]);
  });
});

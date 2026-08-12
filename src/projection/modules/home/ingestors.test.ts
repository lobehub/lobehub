import type {
  BriefItem,
  BriefProjection,
  SidebarAgentItem,
  SidebarAgentListResponse,
  TaskListItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyProjectionCommit } from '../../core/reducer';
import { agentProjectionRecord } from '../agent/ingestors';
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
  labels: [{ color: '#f00', id: 'label-1', name: 'Research' }],
  pinned: true,
  sessionId: 'session-1',
  slug: 'agent-one',
  title: 'Agent One',
  type: 'agent',
  updatedAt: new Date('2026-07-31T00:00:00.000Z'),
  userId: 'user-1',
  visibility: 'public',
  workspaceId: 'workspace-1',
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

describe('Home projection ingestors', () => {
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

    expect(commit.records).toHaveLength(1);
    expect(index?.key).toBe('home.sidebar');
    if (index?.key !== 'home.sidebar') throw new Error('Expected Home sidebar index');
    expect(index.pinned[0]).toEqual({
      id: 'agent-1',
      kind: 'agent',
      labels: sidebarAgent.labels,
      pinned: true,
      updatedAt: sidebarAgent.updatedAt,
    });
    expect(index.pinned[0]).not.toHaveProperty('title');
    expect(index.ungrouped[0].id).toBe(index.pinned[0].id);
    const record = commit.records?.[0];
    expect(record?.kind).toBe('agent');
    if (record?.kind !== 'agent') throw new Error('Expected Agent Projection');
    expect(record.fragments.access?.data.workspaceId).toBe('workspace-1');
  });

  it('does not erase workspace identity when a newer sidebar observation replaces access', () => {
    let scope = applyProjectionCommit(undefined, {
      records: [
        agentProjectionRecord(
          {
            id: sidebarAgent.id,
            title: sidebarAgent.title,
            userId: sidebarAgent.userId ?? undefined,
            workspaceId: sidebarAgent.workspaceId ?? undefined,
          },
          networkObservation,
        ),
      ],
    });
    scope = applyProjectionCommit(
      scope,
      ingestHomeSidebar(
        {
          groups: [],
          pinned: [sidebarAgent],
          privateGroups: [],
          privatePinned: [],
          privateUngrouped: [],
          ungrouped: [],
        },
        { observedAt: 200, source: 'network' },
      ),
    );

    expect(scope.records.agent[sidebarAgent.id].fragments.access?.data.workspaceId).toBe(
      'workspace-1',
    );
  });

  it('normalizes nested Brief enrichments into canonical Agent and Task records', () => {
    const commit = ingestHomeBriefs([brief], networkObservation);
    const records = new Map(
      commit.records?.map((record) => [`${record.kind}:${record.id}`, record]),
    );
    const briefRecord = commit.records?.find(
      (record): record is BriefProjection => record.kind === 'brief' && record.id === 'brief-1',
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

  it('normalizes legacy Brief actions accepted by the API without aborting the feed', () => {
    const commit = ingestHomeBriefs(
      [{ ...brief, actions: [{ label: 'Approve', type: 'approve' }] }],
      networkObservation,
    );
    const record = commit.records?.find((item) => item.kind === 'brief');

    expect(record?.fragments.actions?.data.actions).toEqual([
      { key: 'approve', label: 'Approve', type: 'resolve' },
    ]);
  });

  it('rejects an unknown Brief type at the DTO boundary', () => {
    expect(() =>
      ingestHomeBriefs([{ ...brief, type: 'unknown-type' }], networkObservation),
    ).toThrow('Invalid Brief type payload');
  });

  it('maps a legacy Task status to backlog without aborting the Home feed', () => {
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

    const commit = ingestHomeTasks([task], 1, networkObservation);
    const record = commit.records?.find((item) => item.kind === 'task');

    expect(record?.fragments.lifecycle?.data.status).toBe('backlog');
  });

  it('preserves the complete participant identity and Inbox preview fragments', () => {
    const task = {
      assigneeAgentId: 'agent-1',
      description: null,
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'Task One',
      participants: [
        {
          avatar: null,
          backgroundColor: null,
          id: 'agent-1',
          name: 'Ada',
          title: 'Researcher',
          type: 'agent',
        },
      ],
      status: 'running',
      visibility: 'public',
      workspaceId: 'workspace-1',
    } as unknown as TaskListItem;

    const taskCommit = ingestHomeTasks([task], 1, networkObservation);
    const agent = taskCommit.records?.find((item) => item.kind === 'agent');
    expect(agent?.fragments.identity?.data.name).toBe('Ada');

    const initialScope = applyProjectionCommit(undefined, {
      records: [
        agentProjectionRecord(
          { id: 'agent-1', name: 'Ada', title: 'Researcher' },
          networkObservation,
        ),
      ],
    });
    const taskScope = applyProjectionCommit(
      initialScope,
      ingestHomeTasks([task], 1, { observedAt: 200, source: 'network' }),
    );
    expect(taskScope.records.agent['agent-1'].fragments.identity?.data.name).toBe('Ada');

    const topicCommit = ingestHomeInboxTopics(
      [
        {
          description: 'Keep this note',
          id: 'topic-1',
          lastAssistantMessage: 'Latest reply',
          title: 'Topic',
          updatedAt: 100,
        },
      ],
      networkObservation,
    );
    const topic = topicCommit.records?.find((item) => item.kind === 'topic');
    expect(topic?.fragments.preview?.data).toEqual({
      description: 'Keep this note',
      lastAssistantMessage: 'Latest reply',
    });
  });

  it('commits explicit empty coverage instead of treating an empty response as uninitialized', () => {
    const commit = ingestHomeInboxTopics([], networkObservation);

    expect(commit.records).toEqual([]);
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

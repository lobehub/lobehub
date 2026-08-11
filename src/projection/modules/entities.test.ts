import type {
  AgentGroupDetail,
  AgentProjection,
  BriefItem,
  ChatTopic,
  TaskListItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyProjectionCommit } from '../core/reducer';
import { ingestAgentDirectory } from './agent/ingestors';
import { selectAgentDirectory } from './agent/selectors';
import { ingestBriefNews } from './brief/ingestors';
import { selectBriefNews } from './brief/selectors';
import { ingestChatTopicsPage } from './chat/ingestors';
import { ingestChatGroupDetail } from './chatGroup/ingestors';
import { selectChatGroupDetail } from './chatGroup/selectors';
import { ingestTaskList } from './task/ingestors';
import { selectTaskListItem } from './task/selectors';

const network = { observedAt: 100, source: 'network' as const };

const group = {
  agents: [
    {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      id: 'agent-1',
      isSupervisor: true,
      title: 'Canonical agent',
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      userId: 'user-1',
    },
  ],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  id: 'group-1',
  supervisorAgentId: 'agent-1',
  title: 'Group',
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  userId: 'user-1',
} as AgentGroupDetail;

const brief: BriefItem = {
  actions: null,
  agent: {
    avatar: null,
    backgroundColor: null,
    id: 'agent-1',
    title: 'Canonical agent',
  },
  agentId: 'agent-1',
  artifacts: null,
  createdAt: '2026-08-01T00:00:00.000Z',
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
  taskName: 'Task',
  taskStatus: 'running',
  title: 'Brief',
  topicId: null,
  type: 'insight',
  userId: 'user-1',
};

describe('business entity Projection modules', () => {
  it('stores the Agent directory as refs and resolves edits from canonical records', () => {
    let scope = applyProjectionCommit(
      undefined,
      ingestAgentDirectory([{ id: 'agent-1', title: 'Directory agent' }], {}, network),
    );

    expect(scope.indexes['agent.directory']?.refs).toEqual([{ id: 'agent-1', kind: 'agent' }]);
    expect(selectAgentDirectory(scope)?.[0].title).toBe('Directory agent');

    scope = applyProjectionCommit(scope, {
      records: [
        {
          fragments: {
            identity: {
              data: { title: 'Edited directory agent' },
              observedAt: 200,
              source: 'mutation',
            },
          },
          id: 'agent-1',
          kind: 'agent',
        },
      ],
    });

    expect(selectAgentDirectory(scope)?.[0].title).toBe('Edited directory agent');
  });

  it('normalizes ChatGroup members and rebuilds detail from canonical Agent records', () => {
    let scope = applyProjectionCommit(undefined, ingestChatGroupDetail(group, network));
    const membership = scope.records.chatGroup[group.id].fragments.membership?.data;

    expect(membership?.agents).toEqual([{ id: 'agent-1', isSupervisor: true, kind: 'agent' }]);
    expect(membership?.agents[0]).not.toHaveProperty('title');
    expect(selectChatGroupDetail(scope, group.id)?.agents[0].title).toBe('Canonical agent');

    const identityUpdate: AgentProjection = {
      fragments: {
        identity: {
          data: { title: 'Edited once' },
          observedAt: 200,
          source: 'mutation',
        },
      },
      id: 'agent-1',
      kind: 'agent',
    };
    scope = applyProjectionCommit(scope, { records: [identityUpdate] });

    expect(selectChatGroupDetail(scope, group.id)?.agents[0].title).toBe('Edited once');
  });

  it('normalizes Brief enrichments into Agent and Task records', () => {
    const commit = ingestBriefNews('2026-08-01', true, [brief], network);
    let scope = applyProjectionCommit(undefined, commit);

    expect(scope.records.brief[brief.id].fragments).not.toHaveProperty('enrichment');
    expect(scope.records.agent['agent-1'].fragments.identity?.data.title).toBe('Canonical agent');
    expect(scope.records.task['task-1'].fragments.display?.data.name).toBe('Task');
    expect(selectBriefNews(scope, '2026-08-01')?.[0].taskIdentifier).toBe('TASK-1');

    scope = applyProjectionCommit(scope, {
      records: [
        {
          fragments: {
            identity: {
              data: { title: 'Edited once' },
              observedAt: 200,
              source: 'mutation',
            },
          },
          id: 'agent-1',
          kind: 'agent',
        },
      ],
    });
    expect(selectBriefNews(scope, '2026-08-01')?.[0].agent?.title).toBe('Edited once');
  });

  it('normalizes Task participant agents while preserving list membership as refs', () => {
    const task = {
      assigneeAgentId: 'agent-1',
      description: null,
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'Task',
      participants: [
        {
          avatar: null,
          backgroundColor: null,
          id: 'agent-1',
          title: 'Participant',
          type: 'agent',
        },
      ],
      status: 'running',
      visibility: 'public',
      workspaceId: null,
    } as TaskListItem;
    let scope = applyProjectionCommit(
      undefined,
      ingestTaskList([task], 1, { visibility: 'all' }, network),
    );

    expect(scope.records.agent['agent-1'].fragments.identity?.data.title).toBe('Participant');
    expect(scope.records.task['task-1'].fragments.assignment?.data).not.toHaveProperty(
      'participants',
    );
    expect(scope.records.task['task-1'].fragments.participants?.data.participants).toEqual([
      { id: 'agent-1', kind: 'agent', type: 'agent' },
    ]);
    expect(scope.records.task['task-1'].fragments.row?.data).not.toHaveProperty('name');
    expect(scope.records.task['task-1'].fragments.row?.data).not.toHaveProperty('status');
    expect(scope.indexes['task.list:__none__:all']?.refs).toEqual([{ id: 'task-1', kind: 'task' }]);
    expect(selectTaskListItem(scope, scope.records.task['task-1'])?.participants[0].title).toBe(
      'Participant',
    );

    scope = applyProjectionCommit(scope, {
      records: [
        {
          fragments: {
            identity: {
              data: { title: 'Edited participant' },
              observedAt: 200,
              source: 'mutation',
            },
          },
          id: 'agent-1',
          kind: 'agent',
        },
      ],
    });
    expect(selectTaskListItem(scope, scope.records.task['task-1'])?.participants[0].title).toBe(
      'Edited participant',
    );
  });

  it('stores Topic table rows and query membership independently', () => {
    const topic = {
      createdAt: 100,
      id: 'topic-1',
      title: 'Topic',
      updatedAt: 200,
      userId: 'user-1',
    } as ChatTopic;
    const scope = applyProjectionCommit(
      undefined,
      ingestChatTopicsPage(
        {
          containerKey: 'inbox',
          context: { agentId: null },
          items: [topic],
          page: 0,
          pageSize: 20,
          signature: {},
          surface: 'sidebar',
          total: 1,
        },
        network,
      ),
    );

    expect(scope.records.topic['topic-1'].fragments.display?.data.title).toBe('Topic');
    expect(scope.indexes['chat.sidebarTopics:inbox']?.refs).toEqual([
      { id: 'topic-1', kind: 'topic' },
    ]);
  });
});

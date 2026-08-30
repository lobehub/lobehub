import type {
  AgentGroupDetail,
  AgentProjection,
  BriefItem,
  ChatTopic,
  TaskListItem,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyProjectionCommit } from '../core/reducer';
import { ingestAgentConfig, ingestAgentDirectory } from './agent/ingestors';
import { selectAgentDirectory, selectAgentProjection } from './agent/selectors';
import { ingestBriefNews } from './brief/ingestors';
import { selectBriefNews } from './brief/selectors';
import { ingestChatTopicsPage } from './chat/ingestors';
import { ingestChatGroupDetail, ingestChatGroups } from './chatGroup/ingestors';
import { selectChatGroupDetail } from './chatGroup/selectors';
import { sidebarItemProjectionRecord } from './home/ingestors';
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

  it('keeps complete Agent config and session routing across newer fixed summary DTOs', () => {
    let scope = applyProjectionCommit(
      undefined,
      ingestAgentConfig(
        {
          clientId: 'agent-client-id',
          id: 'agent-1',
          model: 'gpt-5',
          systemRole: 'Private prompt',
          tags: ['research'],
          title: 'Full config title',
        },
        network,
        'full',
      ),
    );

    scope = applyProjectionCommit(
      scope,
      ingestAgentDirectory(
        [
          {
            description: 'Directory description',
            heteroType: null,
            id: 'agent-1',
            slug: 'research-agent',
            title: 'Directory title',
            userId: 'user-1',
            visibility: 'public',
            workspaceId: 'workspace-1',
          },
        ],
        {},
        { observedAt: 200, source: 'network' },
      ),
    );

    expect(selectAgentProjection(scope.records.agent['agent-1'])).toMatchObject({
      clientId: 'agent-client-id',
      description: 'Directory description',
      systemRole: 'Private prompt',
      tags: ['research'],
      title: 'Directory title',
    });

    scope = applyProjectionCommit(scope, {
      records: [
        sidebarItemProjectionRecord(
          {
            id: 'agent-1',
            pinned: false,
            sessionId: 'session-1',
            title: 'Sidebar title',
            type: 'agent',
            updatedAt: new Date(300),
          },
          { observedAt: 300, source: 'network' },
        ),
      ],
    });
    scope = applyProjectionCommit(
      scope,
      ingestAgentConfig(
        { id: 'agent-1', model: 'gpt-5.1', systemRole: 'Updated private prompt' },
        { observedAt: 400, source: 'network' },
        'full',
      ),
    );

    expect(selectAgentProjection(scope.records.agent['agent-1'])).toMatchObject({
      model: 'gpt-5.1',
      sessionId: 'session-1',
      systemRole: 'Updated private prompt',
    });
  });

  it('replaces a full Agent config with the complete safe profile after access is downgraded', () => {
    let scope = applyProjectionCommit(
      undefined,
      ingestAgentConfig(
        {
          agencyConfig: {
            boundDeviceId: 'private-device',
            executionTarget: 'device',
            modelSelectionPolicy: 'member',
          },
          clientId: 'private-client-id',
          id: 'agent-1',
          model: 'gpt-5',
          plugins: ['private-tool'],
          systemRole: 'Private prompt',
          tags: ['private-tag'],
        },
        network,
        'full',
      ),
    );

    scope = applyProjectionCommit(
      scope,
      ingestAgentConfig(
        {
          agencyConfig: {
            executionTarget: 'device',
            modelSelectionPolicy: 'member',
          },
          id: 'agent-1',
          model: 'gpt-5',
          title: 'Visible title',
        },
        { observedAt: 200, source: 'network' },
        'profile',
      ),
    );

    const agent = selectAgentProjection(scope.records.agent['agent-1']);
    expect(agent).toMatchObject({
      agencyConfig: { executionTarget: 'device', modelSelectionPolicy: 'member' },
      model: 'gpt-5',
      title: 'Visible title',
    });
    expect(agent).not.toHaveProperty('clientId');
    expect(agent).not.toHaveProperty('plugins');
    expect(agent).not.toHaveProperty('systemRole');
    expect(agent).not.toHaveProperty('tags');
  });

  it('normalizes ChatGroup members and rebuilds detail from canonical Agent records', () => {
    let scope = applyProjectionCommit(
      undefined,
      ingestChatGroupDetail(group, network, {
        group: 'full',
        members: { 'agent-1': 'full' },
      }),
    );
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

  it('keeps ChatGroup detail coverage when a newer list response refreshes summary fields', () => {
    const detailedGroup = {
      ...group,
      config: { systemPrompt: 'Private group prompt' },
      content: 'Private editor content',
    } as AgentGroupDetail;
    let scope = applyProjectionCommit(
      undefined,
      ingestChatGroupDetail(detailedGroup, network, {
        group: 'full',
        members: { 'agent-1': 'full' },
      }),
    );

    scope = applyProjectionCommit(
      scope,
      ingestChatGroups([{ ...detailedGroup, title: 'List title' }], {
        observedAt: 200,
        source: 'network',
      }),
    );

    expect(selectChatGroupDetail(scope, group.id)).toMatchObject({
      agents: [{ id: 'agent-1', title: 'Canonical agent' }],
      config: { systemPrompt: 'Private group prompt' },
      content: 'Private editor content',
      title: 'List title',
    });
  });

  it('clears ChatGroup and member secrets when detail access becomes profile-only', () => {
    const detailedGroup = {
      ...group,
      agents: [
        {
          ...group.agents[0],
          plugins: ['private-tool'],
          systemRole: 'Private member prompt',
          tags: ['private-tag'],
        },
      ],
      config: { openingMessage: 'Welcome', systemPrompt: 'Private group prompt' },
      content: 'Private editor content',
    } as AgentGroupDetail;
    let scope = applyProjectionCommit(
      undefined,
      ingestChatGroupDetail(detailedGroup, network, {
        group: 'full',
        members: { 'agent-1': 'full' },
      }),
    );
    scope = applyProjectionCommit(
      scope,
      ingestChatGroupDetail(
        detailedGroup,
        { observedAt: 200, source: 'network' },
        {
          group: 'profile',
          members: { 'agent-1': 'profile' },
        },
      ),
    );

    const selected = selectChatGroupDetail(scope, group.id);
    expect(selected).toMatchObject({
      agents: [{ id: 'agent-1', title: 'Canonical agent' }],
      config: { openingMessage: 'Welcome' },
    });
    expect(selected).not.toHaveProperty('content');
    expect(selected?.config).not.toHaveProperty('systemPrompt');
    expect(selected?.agents[0]).not.toHaveProperty('plugins');
    expect(selected?.agents[0]).not.toHaveProperty('systemRole');
    expect(selected?.agents[0]).not.toHaveProperty('tags');
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

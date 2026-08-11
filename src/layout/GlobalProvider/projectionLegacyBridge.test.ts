import type { AgentGroupDetail, BriefItem, ChatTopic, TaskListItem } from '@lobechat/types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyProjectionFragmentEdit } from '@/projection/devtools';
import { useProjectionStore } from '@/projection/store';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useBriefStore } from '@/store/brief';
import { useChatStore } from '@/store/chat';
import { useTaskStore } from '@/store/task';

import { ensureProjectionLegacyBridge } from './projectionLegacyBridge';

const SCOPE = 'user-1:personal';

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCacheScope: () => SCOPE,
}));

const topic: ChatTopic = {
  createdAt: 100,
  favorite: false,
  id: 'topic-1',
  title: 'Network title',
  updatedAt: 100,
  userId: 'user-1',
};

describe('Projection legacy store bridge', () => {
  beforeAll(() => ensureProjectionLegacyBridge());

  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
    useAgentStore.setState({ agentMap: {}, agentNotFoundMap: {}, availableAgents: undefined });
    useAgentGroupStore.setState({ groupMap: {}, groupNotFoundMap: {}, groups: [] });
    useBriefStore.setState({ briefs: [], briefsScope: undefined, isBriefsInit: false });
    useChatStore.setState({ agentTopicsViewMap: {}, searchTopics: [], topicDataMap: {} });
    useTaskStore.setState({
      isTaskListInit: false,
      listAgentId: '__all__',
      listQueryVisibility: 'all',
      taskDetailMap: {},
      tasks: [],
      tasksTotal: 0,
    });
  });

  it('reflects a DevDock fragment edit in the topic UI store', async () => {
    useProjectionStore.getState().commitChatTopicsPage(
      SCOPE,
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
      { observedAt: 100, source: 'network' },
    );

    expect(useChatStore.getState().topicDataMap.inbox?.items[0]?.title).toBe('Network title');

    const record = useProjectionStore.getState().scopes[SCOPE].records.topic[topic.id];
    await applyProjectionFragmentEdit({
      data: { title: 'Edited in DevDock' },
      fragmentName: 'display',
      projection: {
        entryKey: `${SCOPE}:topic:${topic.id}`,
        record,
        scope: SCOPE,
      },
    });

    expect(useChatStore.getState().topicDataMap.inbox?.items[0]?.title).toBe('Edited in DevDock');
  });

  it('reflects Agent, ChatGroup, Task, and Brief edits in their business stores', async () => {
    useProjectionStore.getState().commitAgentConfig(
      SCOPE,
      {
        id: 'agent-1',
        model: 'gpt-4o',
        systemRole: 'System role',
        title: 'Network agent',
      },
      'network',
      100,
    );

    const group = {
      agents: [
        {
          createdAt: new Date(100),
          id: 'agent-1',
          isSupervisor: true,
          model: 'gpt-4o',
          systemRole: 'System role',
          title: 'Network agent',
          updatedAt: new Date(100),
          userId: 'user-1',
        },
      ],
      createdAt: new Date(100),
      id: 'group-1',
      supervisorAgentId: 'agent-1',
      title: 'Network group',
      updatedAt: new Date(100),
      userId: 'user-1',
    } as AgentGroupDetail;
    useProjectionStore.getState().commitChatGroupDetail(SCOPE, group, 'network', 100);

    const task = {
      assigneeAgentId: 'agent-1',
      description: 'Description',
      id: 'task-1',
      identifier: 'TASK-1',
      name: 'Network task',
      participants: [],
      status: 'backlog',
      visibility: 'public',
      workspaceId: null,
    } as unknown as TaskListItem;
    useProjectionStore
      .getState()
      .commitTaskList(SCOPE, [task], 1, { agentKey: '__all__', visibility: 'all' }, 100);

    const brief: BriefItem = {
      actions: null,
      agent: null,
      agentId: null,
      artifacts: null,
      createdAt: '2026-08-11T00:00:00.000Z',
      cronJobId: null,
      id: 'brief-1',
      priority: null,
      readAt: null,
      resolvedAction: null,
      resolvedAt: null,
      resolvedComment: null,
      summary: 'Summary',
      taskId: null,
      title: 'Network brief',
      topicId: null,
      type: 'result',
      userId: 'user-1',
    };
    useProjectionStore.getState().ingestHomeBriefs(SCOPE, [brief], 100);

    const edits = [
      { data: { title: 'Edited agent' }, fragmentName: 'identity', id: 'agent-1', kind: 'agent' },
      {
        data: {
          ...useProjectionStore.getState().scopes[SCOPE].records.chatGroup['group-1'].fragments
            .identity?.data,
          title: 'Edited group',
        },
        fragmentName: 'identity',
        id: 'group-1',
        kind: 'chatGroup',
      },
      { data: { name: 'Edited task' }, fragmentName: 'display', id: 'task-1', kind: 'task' },
      {
        data: {
          ...useProjectionStore.getState().scopes[SCOPE].records.brief['brief-1'].fragments.content
            ?.data,
          title: 'Edited brief',
        },
        fragmentName: 'content',
        id: 'brief-1',
        kind: 'brief',
      },
    ] as const;

    for (const edit of edits) {
      const record = useProjectionStore.getState().scopes[SCOPE].records[edit.kind][edit.id];
      await applyProjectionFragmentEdit({
        data: edit.data,
        fragmentName: edit.fragmentName,
        projection: {
          entryKey: `${SCOPE}:${edit.kind}:${edit.id}`,
          record,
          scope: SCOPE,
        },
      });
    }

    expect(useAgentStore.getState().agentMap['agent-1']?.title).toBe('Edited agent');
    expect(useAgentGroupStore.getState().groupMap['group-1']?.title).toBe('Edited group');
    expect(useTaskStore.getState().tasks[0]?.name).toBe('Edited task');
    expect(useBriefStore.getState().briefs[0]?.title).toBe('Edited brief');
  });
});

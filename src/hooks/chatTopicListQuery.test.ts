import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';

import { deriveSidebarTopicListQuery, getSidebarTopicListParams } from './chatTopicListQuery';

const agentStateMock = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  agentMap: {} as Record<string, any>,
  builtinAgentIdMap: { inbox: 'agt_inbox' } as Record<string, string>,
}));
const globalStateMock = vi.hoisted(() => ({ topicPageSize: 20 }));
const userStateMock = vi.hoisted(() => ({
  topicGroupMode: 'byTime' as string,
  topicIncludeCompleted: false,
}));

vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => agentStateMock } }));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (s: typeof agentStateMock) => s.agentMap[s.activeAgentId!],
    getAgentConfigById: (id: string) => (s: typeof agentStateMock) => s.agentMap[id],
  },
  builtinAgentSelectors: {
    inboxAgentId: (s: typeof agentStateMock) => s.builtinAgentIdMap.inbox,
  },
}));

vi.mock('@/store/global', () => ({ useGlobalStore: { getState: () => globalStateMock } }));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { topicPageSize: (s: typeof globalStateMock) => s.topicPageSize },
}));

vi.mock('@/store/user', () => ({ useUserStore: { getState: () => userStateMock } }));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    topicGroupMode: (s: typeof userStateMock) => s.topicGroupMode,
    topicIncludeCompleted: (s: typeof userStateMock) => s.topicIncludeCompleted,
  },
}));

describe('deriveSidebarTopicListQuery', () => {
  it('hides completed topics and keeps the sidebar trigger filter by default', () => {
    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: false,
        topicGroupMode: 'byTime',
      }),
    ).toEqual({
      excludeStatuses: ['completed'],
      excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
      sortBy: undefined,
    });
  });

  it('drops the completed filter when the preference includes them', () => {
    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: true,
        isGroupSession: false,
        topicGroupMode: 'byTime',
      }).excludeStatuses,
    ).toBeUndefined();
  });

  it('sorts by status only for an agent session grouped by status', () => {
    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: false,
        topicGroupMode: 'byStatus',
      }).sortBy,
    ).toBe('status');

    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: true,
        topicGroupMode: 'byStatus',
      }).sortBy,
    ).toBeUndefined();
  });
});

describe('getSidebarTopicListParams', () => {
  beforeEach(() => {
    agentStateMock.activeAgentId = 'agent-1';
    agentStateMock.agentMap = {};
    globalStateMock.topicPageSize = 20;
    userStateMock.topicGroupMode = 'byTime';
    userStateMock.topicIncludeCompleted = false;
  });

  it('returns nothing without a session', () => {
    expect(getSidebarTopicListParams({})).toBeNull();
  });

  it('builds the exact request the sidebar will make for a route agent', () => {
    expect(getSidebarTopicListParams({ agentId: 'agent-7' })).toEqual({
      agentId: 'agent-7',
      excludeStatuses: ['completed'],
      excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
      isInbox: false,
      pageSize: 20,
    });
  });

  it('flags the inbox agent and honours the page size preference', () => {
    globalStateMock.topicPageSize = 30;

    expect(getSidebarTopicListParams({ agentId: 'agt_inbox' })).toMatchObject({
      isInbox: true,
      pageSize: 30,
    });
  });

  it('resolves the group mode from the route agent config, not the active one', () => {
    agentStateMock.activeAgentId = 'some-other-agent';
    agentStateMock.agentMap['agent-7'] = { chatConfig: { topicGroupMode: 'byStatus' } };

    expect(getSidebarTopicListParams({ agentId: 'agent-7' })?.sortBy).toBe('status');
  });

  it('never flags a group session as inbox and keeps its default ordering', () => {
    userStateMock.topicGroupMode = 'byStatus';

    expect(getSidebarTopicListParams({ groupId: 'grp_1' })).toEqual({
      groupId: 'grp_1',
      excludeStatuses: ['completed'],
      excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
      isInbox: false,
      pageSize: 20,
    });
  });
});

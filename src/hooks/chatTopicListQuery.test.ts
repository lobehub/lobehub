import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';

import { deriveSidebarTopicListQuery, getSidebarTopicListParams } from './chatTopicListQuery';

const agentStateMock = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  agentMap: {} as Record<string, any>,
  builtinAgentIdMap: { inbox: 'agt_inbox' } as Record<string, string>,
}));
const globalStateMock = vi.hoisted(() => ({
  topicOnlyMineByAgent: {} as Record<string, boolean>,
  topicPageSize: 20,
}));
const userStateMock = vi.hoisted(() => ({
  topicGroupMode: 'byTime' as string,
  topicIncludeCompleted: false,
}));
const workspaceMock = vi.hoisted(() => ({ activeWorkspaceId: 'ws-1' as string | null }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => workspaceMock.activeWorkspaceId,
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
  systemStatusSelectors: {
    topicOnlyMine: (ownerId?: string) => (s: typeof globalStateMock) =>
      !!ownerId && !!s.topicOnlyMineByAgent[ownerId],
    topicPageSize: (s: typeof globalStateMock) => s.topicPageSize,
  },
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
        onlyMine: false,
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
        onlyMine: false,
        topicGroupMode: 'byTime',
      }).excludeStatuses,
    ).toBeUndefined();
  });

  it('sorts by status only for an agent session grouped by status', () => {
    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: false,
        onlyMine: false,
        topicGroupMode: 'byStatus',
      }).sortBy,
    ).toBe('status');

    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: true,
        onlyMine: false,
        topicGroupMode: 'byStatus',
      }).sortBy,
    ).toBeUndefined();
  });

  it('asks the server for only the caller topics when the workspace filter is on', () => {
    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: false,
        onlyMine: true,
        topicGroupMode: 'byTime',
      }).onlyMine,
    ).toBe(true);

    expect(
      deriveSidebarTopicListQuery({
        includeCompleted: false,
        isGroupSession: false,
        onlyMine: false,
        topicGroupMode: 'byTime',
      }).onlyMine,
    ).toBeUndefined();
  });
});

describe('getSidebarTopicListParams', () => {
  beforeEach(() => {
    agentStateMock.activeAgentId = 'agent-1';
    agentStateMock.agentMap = {};
    globalStateMock.topicOnlyMineByAgent = {};
    globalStateMock.topicPageSize = 20;
    userStateMock.topicGroupMode = 'byTime';
    userStateMock.topicIncludeCompleted = false;
    workspaceMock.activeWorkspaceId = 'ws-1';
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

  it("carries the route agent's own only-mine choice into the pre-paint request", () => {
    globalStateMock.topicOnlyMineByAgent = { 'agent-7': true };

    expect(getSidebarTopicListParams({ agentId: 'agent-7' })?.onlyMine).toBe(true);
    expect(getSidebarTopicListParams({ agentId: 'agent-8' })?.onlyMine).toBeUndefined();
  });

  it('keys a group session by its group id', () => {
    globalStateMock.topicOnlyMineByAgent = { grp_1: true };

    expect(getSidebarTopicListParams({ groupId: 'grp_1' })?.onlyMine).toBe(true);
  });

  /** @example Personal mode has nobody else's topics to hide, whatever the device remembers. */
  it('ignores a remembered choice outside a workspace', () => {
    globalStateMock.topicOnlyMineByAgent = { 'agent-7': true };
    workspaceMock.activeWorkspaceId = null;

    expect(getSidebarTopicListParams({ agentId: 'agent-7' })?.onlyMine).toBeUndefined();
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

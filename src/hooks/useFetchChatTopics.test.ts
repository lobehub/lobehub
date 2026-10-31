import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';

import { useFetchAgentChatTopics, useFetchChatTopics } from './useFetchChatTopics';

const mocks = vi.hoisted(() => ({
  activeAgentId: 'agent-1' as string | undefined,
  activeGroupId: undefined as string | undefined,
  inboxAgentId: 'inbox' as string | undefined,
  storeFetchTopics: vi.fn(
    (_enable: boolean, _args: Record<string, unknown> = {}) =>
      ({ data: undefined, isValidating: false }) as never,
  ),
  topicGroupMode: 'byStatus' as string,
  topicIncludeCompleted: false,
  topicOnlyMine: false,
  topicOnlyMineOwners: [] as (string | undefined)[],
  topicPageSize: 20,
}));

vi.mock('@/hooks/useTopicOnlyMine', () => ({
  useTopicOnlyMine: (ownerId?: string) => {
    mocks.topicOnlyMineOwners.push(ownerId);
    return mocks.topicOnlyMine;
  },
}));

vi.mock('@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode', () => ({
  useAgentTopicGroupMode: () => ({ topicGroupMode: mocks.topicGroupMode }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: () => mocks.inboxAgentId,
    isInboxAgent: () => mocks.activeAgentId === mocks.inboxAgentId,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeAgentId: mocks.activeAgentId,
      activeGroupId: mocks.activeGroupId,
      useFetchTopics: mocks.storeFetchTopics,
      topicDataMap: {},
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { topicPageSize: () => mocks.topicPageSize },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { topicIncludeCompleted: () => mocks.topicIncludeCompleted },
}));

describe('chat topic list fetches', () => {
  beforeEach(() => {
    mocks.storeFetchTopics.mockClear();
    mocks.topicOnlyMine = false;
    mocks.topicOnlyMineOwners = [];
  });

  it('asks the same query for a named agent as the sidebar does for the active one', () => {
    // Both write into `topicDataMap[agent_<id>]`, which is keyed by container
    // and not by filters — a looser query here overwrites the sidebar's list
    // with task-run / cron / doc / eval topics the moment the panel mounts.
    renderHook(() => useFetchChatTopics());
    const sidebarCall = mocks.storeFetchTopics.mock.calls.at(-1)!;

    renderHook(() => useFetchAgentChatTopics('agent-1'));
    const panelCall = mocks.storeFetchTopics.mock.calls.at(-1)!;

    const [sidebarEnabled, sidebarArgs = {}] = sidebarCall;
    const [panelEnabled, panelArgs = {}] = panelCall;

    expect(sidebarEnabled).toBe(true);
    expect(panelEnabled).toBe(true);
    expect(panelArgs).toMatchObject({
      agentId: 'agent-1',
      excludeStatuses: sidebarArgs.excludeStatuses,
      excludeTriggers: sidebarArgs.excludeTriggers,
      isInbox: sidebarArgs.isInbox,
      pageSize: sidebarArgs.pageSize,
      sortBy: sidebarArgs.sortBy,
    });
    expect(panelArgs.excludeTriggers).toEqual(MAIN_SIDEBAR_EXCLUDE_TRIGGERS);
  });

  it('forwards the per-agent only-mine filter from both the sidebar and the panel', () => {
    mocks.topicOnlyMine = true;

    renderHook(() => useFetchChatTopics());
    const [, sidebarArgs = {}] = mocks.storeFetchTopics.mock.calls.at(-1)!;

    renderHook(() => useFetchAgentChatTopics('agent-1'));
    const [, panelArgs = {}] = mocks.storeFetchTopics.mock.calls.at(-1)!;

    expect(sidebarArgs.onlyMine).toBe(true);
    expect(panelArgs.onlyMine).toBe(true);
  });

  /** @example A goal-chat panel reads the choice of the agent it names, not the active session's. */
  it('reads the panel agent its own only-mine choice', () => {
    renderHook(() => useFetchAgentChatTopics('agent-2'));

    expect(mocks.topicOnlyMineOwners.at(-1)).toBe('agent-2');
  });

  it('stays disabled until the panel knows its agent', () => {
    renderHook(() => useFetchAgentChatTopics(undefined));

    const [enabled] = mocks.storeFetchTopics.mock.calls.at(-1)!;

    expect(enabled).toBe(false);
  });
});

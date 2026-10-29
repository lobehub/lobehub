import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListScopeContext } from '@/features/AgentSidebar/Topic/TopicListScope';

import { useSetTopicOnlyMine, useTopicOnlyMine, useTopicOnlyMineOwnerId } from './useTopicOnlyMine';

const mocks = vi.hoisted(() => ({
  chat: { activeAgentId: 'agent-1', activeGroupId: undefined as string | undefined },
  global: {
    status: { topicOnlyMineByAgent: {} as Record<string, boolean> },
    updateSystemStatus: vi.fn(),
  },
  hasActiveWorkspace: true,
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => mocks.hasActiveWorkspace,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof mocks.chat) => unknown) => selector(mocks.chat),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: typeof mocks.global) => unknown) => selector(mocks.global),
}));

const projectScope = ({ children }: PropsWithChildren) =>
  createElement(TopicListScopeContext, { value: { projectId: 'project-a' } }, children);

describe('useTopicOnlyMine', () => {
  beforeEach(() => {
    mocks.chat.activeAgentId = 'agent-1';
    mocks.chat.activeGroupId = undefined;
    mocks.global.status.topicOnlyMineByAgent = {};
    mocks.global.updateSystemStatus.mockClear();
    mocks.hasActiveWorkspace = true;
  });

  /** @example Turning it on for one agent used to filter every agent in the workspace. */
  it("reads only the active agent's own choice", () => {
    mocks.global.status.topicOnlyMineByAgent = { 'agent-2': true };

    expect(renderHook(() => useTopicOnlyMine()).result.current).toBe(false);

    mocks.chat.activeAgentId = 'agent-2';
    expect(renderHook(() => useTopicOnlyMine()).result.current).toBe(true);
  });

  it('prefers an explicitly named agent over the active one', () => {
    mocks.global.status.topicOnlyMineByAgent = { 'agent-2': true };

    expect(renderHook(() => useTopicOnlyMine('agent-2')).result.current).toBe(true);
  });

  it('is always off in personal mode', () => {
    mocks.global.status.topicOnlyMineByAgent = { 'agent-1': true };
    mocks.hasActiveWorkspace = false;

    expect(renderHook(() => useTopicOnlyMine()).result.current).toBe(false);
  });

  it('keys a project sidebar by project and a group by group', () => {
    mocks.chat.activeGroupId = 'grp-1';
    expect(renderHook(() => useTopicOnlyMineOwnerId()).result.current).toBe('grp-1');
    expect(
      renderHook(() => useTopicOnlyMineOwnerId(), { wrapper: projectScope }).result.current,
    ).toBe('project-a');
  });

  it('stores the choice locally under its owner', () => {
    const { result } = renderHook(() => useSetTopicOnlyMine());
    result.current('agent-1', true);

    expect(mocks.global.updateSystemStatus).toHaveBeenCalledWith({
      topicOnlyMineByAgent: { 'agent-1': true },
    });
  });
});

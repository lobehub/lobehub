/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TopicListFilterContext,
  TopicListRevealContext,
  TopicListScopeContext,
} from './TopicListScope';
import {
  pinCoordinatorGroup,
  useOnlyMineTopics,
  useScopedSidebarTopics,
  withCoordinatorGroup,
} from './useScopedTopics';

const fixture = vi.hoisted(() => ({ topicId: undefined as string | undefined }));
const userFixture = vi.hoisted(() => ({ topicOnlyMine: false, userId: 'me' }));
const updateSystemStatus = vi.hoisted(() => vi.fn());
const rows = [
  {
    id: 'old',
    userId: 'me',
    title: 'Old',
    agentId: 'agent-a',
    createdAt: 10,
    updatedAt: 40,
    status: 'active',
    favorite: false,
    metadata: { boundDeviceId: 'device-a' },
  },
  {
    id: 'new',
    userId: 'teammate',
    title: 'New',
    agentId: 'agent-b',
    createdAt: 30,
    updatedAt: 30,
    status: 'failed',
    favorite: false,
  },
  {
    id: 'star',
    userId: 'me',
    title: 'Favorite',
    agentId: 'agent-a',
    createdAt: 5,
    updatedAt: 5,
    status: 'active',
    favorite: true,
  },
  {
    id: 'done',
    userId: 'teammate',
    title: 'Completed',
    agentId: 'agent-b',
    createdAt: 50,
    updatedAt: 50,
    status: 'completed',
    favorite: false,
  },
];
vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => [],
  useProjectDirectoryStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchProjectTopics: () => ({ hasData: true, revalidate: async () => {} }) }),
  useProjectTopics: () => rows,
}));
vi.mock('@/hooks/useActiveRouteParams', () => ({ useActiveRouteParams: () => fixture }));
vi.mock('@/store/chat', () => ({ useChatStore: () => new Set<string>() }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) => selector({ updateSystemStatus }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: typeof userFixture) => unknown) => selector(userFixture),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (s: typeof userFixture) => s.userId },
  workspaceUserSettingsSelectors: {
    topicOnlyMine: () => (s: typeof userFixture) => s.topicOnlyMine,
  },
}));
vi.mock('i18next', () => ({ t: (key: string) => key }));

const RevealHost = ({ children }: PropsWithChildren) => {
  const [extraRows, setExtraRows] = useState(0);
  return createElement(
    TopicListRevealContext,
    { value: { extraRows, revealMore: () => setExtraRows((rows) => rows + 20) } },
    children,
  );
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    TopicListScopeContext,
    { value: { projectId: 'project-a' } },
    createElement(RevealHost, null, children),
  );

describe('Project topics use the canonical Agent sidebar rules', () => {
  beforeEach(() => {
    fixture.topicId = undefined;
    userFixture.topicOnlyMine = false;
    updateSystemStatus.mockClear();
  });
  it('lists only the caller topics with the workspace only-mine filter, keeping the open one', () => {
    userFixture.topicOnlyMine = true;
    const { result, rerender } = renderHook(
      () => useScopedSidebarTopics(20, 'updatedAt', 'flat', false),
      { wrapper },
    );
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star', 'old']);
    expect(result.current.hasMore).toBe(false);

    fixture.topicId = 'new';
    rerender();
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star', 'old', 'new']);
  });
  it('pins favorites and orders the rest by the selected timestamp across Agents', () => {
    const { result, rerender } = renderHook(
      ({ sort }: { sort: 'createdAt' | 'updatedAt' }) =>
        useScopedSidebarTopics(20, sort, 'flat', false),
      { wrapper, initialProps: { sort: 'updatedAt' } },
    );
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star', 'old', 'new']);
    rerender({ sort: 'createdAt' });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star', 'new', 'old']);
  });
  it('uses the needs-attention status bucket and keeps favorites separate', () => {
    const { result } = renderHook(
      () => useScopedSidebarTopics(20, 'updatedAt', 'byStatus', false),
      { wrapper },
    );
    expect(result.current.groups.map((group) => group.id)).toEqual([
      'favorite',
      'pending',
      'active',
    ]);
    expect(
      result.current.groups
        .find((group) => group.id === 'pending')
        ?.children.map((topic) => topic.id),
    ).toEqual(['new']);
  });
  it('reveals completed topics on request, and preserves the active completed topic when filtered', () => {
    const { result, rerender } = renderHook(
      ({ include }: { include: boolean }) =>
        useScopedSidebarTopics(20, 'updatedAt', 'flat', include),
      { wrapper, initialProps: { include: true } },
    );
    expect(result.current.topics.map((topic) => topic.id)).toContain('done');
    fixture.topicId = 'done';
    rerender({ include: false });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star', 'old', 'new', 'done']);
  });
  it('groups topics by their bound device in byDevice mode', () => {
    const { result } = renderHook(
      () => useScopedSidebarTopics(20, 'updatedAt', 'byDevice', false),
      { wrapper },
    );
    expect(result.current.groups.map((group) => group.id)).toEqual([
      'favorite',
      'device:device-a',
      'no-device',
    ]);
  });
  it('does not silently lose topics beyond the page limit', () => {
    const { result } = renderHook(() => useScopedSidebarTopics(1, 'updatedAt', 'flat', false), {
      wrapper,
    });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star']);
    expect(result.current.hasMore).toBe(true);
  });
  // Growing the global `topicPageSize` past the server's `getTopics` cap of
  // 100 made every Agent's topic list fail validation, so "load more" in a
  // project only reveals more of the already-loaded rows.
  it('loads more project topics without growing the global topic page size', () => {
    // The list and the collapse-all toggle each call the hook; both must see
    // the revealed rows.
    const { result } = renderHook(
      () => ({
        list: useScopedSidebarTopics(1, 'updatedAt', 'byAgent', false),
        toggle: useScopedSidebarTopics(1, 'updatedAt', 'byAgent', false),
      }),
      { wrapper },
    );
    act(() => result.current.list.loadMore());
    expect(result.current.list.topics.map((topic) => topic.id)).toEqual(['star', 'old', 'new']);
    expect(result.current.list.hasMore).toBe(false);
    expect(result.current.toggle.groups).toEqual(result.current.list.groups);
    expect(updateSystemStatus).not.toHaveBeenCalled();
  });

  it("puts the project's main agent first among the agent groups, below favorites", () => {
    const coordinatorWrapper = ({ children }: PropsWithChildren) =>
      createElement(
        TopicListScopeContext,
        { value: { coordinatorAgentId: 'agent-b', projectId: 'project-a' } },
        createElement(RevealHost, null, children),
      );
    const { result } = renderHook(() => useScopedSidebarTopics(20, 'updatedAt', 'byAgent', false), {
      wrapper: coordinatorWrapper,
    });
    // agent-a holds the most recently updated topic, so recency alone would lead with it.
    expect(result.current.groups.map((group) => group.id)).toEqual([
      'favorite',
      'agent:agent-b',
      'agent:agent-a',
    ]);
  });
});

describe('Project topic filters', () => {
  const filteredWrapper =
    (filter: { device?: string; status?: 'pending' | 'running' | 'scheduled' | 'active' }) =>
    ({ children }: PropsWithChildren) =>
      createElement(
        TopicListScopeContext,
        { value: { projectId: 'project-a' } },
        createElement(
          TopicListFilterContext,
          { value: { filter, setFilter: () => {} } },
          createElement(RevealHost, null, children),
        ),
      );

  beforeEach(() => {
    fixture.topicId = undefined;
  });

  it('narrows the agent groups to one status bucket', () => {
    const { result } = renderHook(() => useScopedSidebarTopics(20, 'updatedAt', 'byAgent', false), {
      wrapper: filteredWrapper({ status: 'pending' }),
    });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['new']);
    expect(result.current.groups.map((group) => group.id)).toEqual(['agent:agent-b']);
  });

  it('narrows to the topics on one device', () => {
    const { result } = renderHook(() => useScopedSidebarTopics(20, 'updatedAt', 'byAgent', false), {
      wrapper: filteredWrapper({ device: 'device-a' }),
    });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['old']);
  });

  it('narrows strictly, even past the open topic', () => {
    fixture.topicId = 'star';
    const { result } = renderHook(() => useScopedSidebarTopics(20, 'updatedAt', 'byAgent', false), {
      wrapper: filteredWrapper({ device: 'device-a' }),
    });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['old']);
  });
});

describe('pinCoordinatorGroup', () => {
  const group = (id: string) => ({ children: [], id, title: id });

  it('leads with the main agent when there are no favorites', () => {
    expect(
      pinCoordinatorGroup([group('agent:a'), group('agent:b'), group('no-agent')], 'b').map(
        (g) => g.id,
      ),
    ).toEqual(['agent:b', 'agent:a', 'no-agent']);
  });

  it('keeps the order when the main agent already leads or has no topics', () => {
    const groups = [group('favorite'), group('agent:b'), group('agent:a')];
    expect(pinCoordinatorGroup(groups, 'b')).toBe(groups);
    expect(pinCoordinatorGroup(groups, 'missing')).toBe(groups);
    expect(pinCoordinatorGroup(groups, undefined)).toBe(groups);
  });
});

describe('withCoordinatorGroup', () => {
  /** @example Review feedback: an empty project showed text, not the main agent's group with "new topic". */
  it('shows the main agent as an empty group named from the project when there is no topic', () => {
    expect(
      withCoordinatorGroup([], {
        coordinatorAgent: { name: null, title: '官网改版 Coordinator' },
        coordinatorAgentId: 'agt_lead',
      }),
    ).toEqual([{ children: [], id: 'agent:agt_lead', title: '官网改版 Coordinator' }]);
  });

  it('leaves existing groups and scopes without a main agent alone', () => {
    const groups = [{ children: [], id: 'agent:a', title: 'a' }];
    expect(withCoordinatorGroup(groups, { coordinatorAgentId: 'agt_lead' })).toBe(groups);
    expect(withCoordinatorGroup([], { coordinatorAgentId: undefined })).toEqual([]);
    expect(withCoordinatorGroup([], null)).toEqual([]);
  });
});

describe('useOnlyMineTopics', () => {
  beforeEach(() => {
    userFixture.topicOnlyMine = false;
  });

  /** @example A project holding only teammates' topics must show its empty state, not a blank list. */
  it('leaves nothing when every topic belongs to a teammate', () => {
    userFixture.topicOnlyMine = true;
    const teammates = rows.filter((topic) => topic.userId === 'teammate');

    const { result } = renderHook(() => useOnlyMineTopics(teammates));

    expect(result.current).toEqual([]);
  });

  it('keeps every topic when the filter is off', () => {
    const { result } = renderHook(() => useOnlyMineTopics(rows));

    expect(result.current).toHaveLength(rows.length);
  });
});

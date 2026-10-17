/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListRevealContext, TopicListScopeContext } from './TopicListScope';
import { useScopedSidebarTopics } from './useScopedTopics';

const fixture = vi.hoisted(() => ({ topicId: undefined as string | undefined }));
const updateSystemStatus = vi.hoisted(() => vi.fn());
const rows = [
  {
    id: 'old',
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
    title: 'New',
    agentId: 'agent-b',
    createdAt: 30,
    updatedAt: 30,
    status: 'failed',
    favorite: false,
  },
  {
    id: 'star',
    title: 'Favorite',
    agentId: 'agent-a',
    createdAt: 5,
    updatedAt: 5,
    status: 'active',
    favorite: true,
  },
  {
    id: 'done',
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
    updateSystemStatus.mockClear();
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
});

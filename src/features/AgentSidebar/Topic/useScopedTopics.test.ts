/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListScopeContext } from './TopicListScope';
import { useScopedSidebarTopics } from './useScopedTopics';

const fixture = vi.hoisted(() => ({ topicId: undefined as string | undefined }));
const rows = [
  {
    id: 'old',
    title: 'Old',
    agentId: 'agent-a',
    createdAt: 10,
    updatedAt: 40,
    status: 'active',
    favorite: false,
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
  useProjectDirectoryStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchProjectTopics: () => ({ data: { data: rows } }) }),
}));
vi.mock('@/hooks/useActiveRouteParams', () => ({ useActiveRouteParams: () => fixture }));
vi.mock('@/store/chat', () => ({ useChatStore: () => new Set<string>() }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => vi.fn() }));
vi.mock('i18next', () => ({ t: (key: string) => key }));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(TopicListScopeContext, { value: { projectId: 'project-a' } }, children);

describe('Project topics use the canonical Agent sidebar rules', () => {
  beforeEach(() => {
    fixture.topicId = undefined;
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
  it('does not silently lose topics beyond the page limit', () => {
    const { result } = renderHook(() => useScopedSidebarTopics(1, 'updatedAt', 'flat', false), {
      wrapper,
    });
    expect(result.current.topics.map((topic) => topic.id)).toEqual(['star']);
    expect(result.current.hasMore).toBe(true);
  });
});

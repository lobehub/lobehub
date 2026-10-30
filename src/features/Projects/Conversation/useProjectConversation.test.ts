import { render, renderHook, screen } from '@testing-library/react';
import { createElement, Fragment, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/store/project';
import { type ProjectListItem } from '@/store/project';

import { useProjectConversation } from './useProjectConversation';

const mocks = vi.hoisted(() => ({
  fetchDirectories: vi.fn(),
  fetchTopics: vi.fn(),
  topics: [] as { agentId: string; id: string; title: string }[],
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => [],
  useProjectDirectoryStore: (selector: (s: unknown) => unknown) =>
    selector({
      useFetchDirectories: mocks.fetchDirectories,
      useFetchProjectTopics: mocks.fetchTopics,
    }),
  useProjectTopics: (projectId?: string) => (projectId ? mocks.topics : []),
}));

vi.mock('@/hooks/useInitAgentConfig', () => ({
  useInitAgentConfig: () => ({ isLoading: false }),
}));

vi.mock('./useMarkProjectTopicRead', () => ({ useMarkProjectTopicRead: vi.fn() }));

vi.mock('@/store/chat', async (importOriginal) => {
  const actual = await importOriginal<{ useChatStore: { setState: (s: unknown) => void } }>();
  actual.useChatStore.setState({
    useFetchTopicDetail: () => ({ error: undefined, revalidate: vi.fn() }),
  });
  return actual;
});

const listRequest = { hasData: true, error: undefined, revalidate: vi.fn() };
const pendingDetail = {
  error: undefined,
  isHydrated: true,
  isValidating: true,
  revalidate: vi.fn(),
};

const project = {
  coordinatorAgentId: 'agt_coord',
  id: 'prj_launch',
  name: 'Launch',
  slug: 'launch',
} as ProjectListItem;

const wrapper =
  (path: string) =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { element: children, path: '/project/:projectId/topic/:topicId?' }),
      ),
    );

describe('useProjectConversation', () => {
  beforeEach(() => {
    mocks.topics = [{ agentId: 'agt_owner', id: 'tpc_1', title: 'Ship it' }];
    mocks.fetchTopics.mockReset().mockReturnValue(listRequest);
    mocks.fetchDirectories.mockReset().mockReturnValue(listRequest);
    // The heavy project detail never answers.
    useProjectStore.setState({
      projectDetailMap: {},
      projectListMap: { all: [project] },
      useFetchProjectDetail: vi.fn(() => pendingDetail),
    } as any);
  });

  afterEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState());
  });

  /** @example A project topic must not sit on a blank spinner while the project detail is slow. */
  it('loads the topics from the listed project without waiting for its detail', () => {
    const { result } = renderHook(() => useProjectConversation(), {
      wrapper: wrapper('/project/launch/topic/tpc_1'),
    });

    expect(mocks.fetchTopics).toHaveBeenCalledWith('prj_launch');
    expect(result.current.stage).not.toBe('loading');
    expect(result.current.title).toBe('Ship it');
  });

  it('starts the topic request from an id-shaped param before the project list loads', () => {
    useProjectStore.setState({ projectListMap: {} } as any);

    renderHook(() => useProjectConversation(), {
      wrapper: wrapper('/project/prj_launch/topic/tpc_1'),
    });

    expect(mocks.fetchTopics).toHaveBeenCalledWith('prj_launch');
  });

  it('does not call a topic missing while the id is only guessed from the param', () => {
    useProjectStore.setState({ projectListMap: {} } as any);
    mocks.topics = [];

    const { result } = renderHook(() => useProjectConversation(), {
      wrapper: wrapper('/project/prj_launch/topic/tpc_1'),
    });
    const { container } = render(createElement(Fragment, null, result.current.fallback));

    expect(screen.queryByText('topics.notFound')).toBeNull();
    expect(container.querySelector('[aria-busy]')).not.toBeNull();
  });

  it('keeps waiting instead of failing when a guessed id turns out to be a slug', () => {
    useProjectStore.setState({ projectListMap: {} } as any);
    mocks.topics = [];
    // `prj_launch` is a custom slug: the topic request by that "id" fails.
    mocks.fetchTopics.mockReturnValue({
      ...listRequest,
      error: new Error('Project not found or access denied'),
      hasData: false,
    });

    const { result } = renderHook(() => useProjectConversation(), {
      wrapper: wrapper('/project/prj_launch/topic/tpc_1'),
    });
    const { container } = render(createElement(Fragment, null, result.current.fallback));

    expect(screen.queryByText('Project not found or access denied')).toBeNull();
    expect(container.querySelector('[aria-busy]')).not.toBeNull();
  });
});

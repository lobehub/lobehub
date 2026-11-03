/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMarkSidebarTopicGoal } from './useMarkSidebarTopicGoal';

const chat = vi.hoisted(() => ({
  dispatch: vi.fn(),
  topic: undefined as { hasGoal?: boolean; id: string; projectId?: string } | undefined,
}));
const project = vi.hoisted(() => ({
  refresh: vi.fn(),
  rows: {} as Record<string, { hasGoal?: boolean; id: string }[]>,
}));

vi.mock('@/store/chat', () => {
  const useChatStore = (selector: (state: unknown) => unknown) => selector({});
  useChatStore.getState = () => ({ internal_dispatchTopic: chat.dispatch });
  return { useChatStore };
});
vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: () => () => chat.topic },
}));
vi.mock('@/store/projectWorkingDirectory', () => {
  const useProjectDirectoryStore = (selector: (state: unknown) => unknown) =>
    selector({ projectTopicsMap: project.rows });
  useProjectDirectoryStore.getState = () => ({ refreshProjectTopics: project.refresh });
  return { useProjectDirectoryStore };
});

afterEach(() => {
  chat.dispatch.mockReset();
  chat.topic = undefined;
  project.refresh.mockReset();
  project.rows = {};
});

describe('useMarkSidebarTopicGoal', () => {
  it('marks the agent row and refetches the project list once a goal is confirmed', () => {
    chat.topic = { id: 'tpc', projectId: 'prj' };
    project.rows = { prj: [{ hasGoal: false, id: 'tpc' }] };

    const { rerender } = renderHook(() => useMarkSidebarTopicGoal('tpc', true));
    rerender();

    expect(chat.dispatch).toHaveBeenCalledWith({
      id: 'tpc',
      type: 'updateTopic',
      value: { hasGoal: true },
    });
    expect(project.refresh).toHaveBeenCalledTimes(1);
    expect(project.refresh).toHaveBeenCalledWith('prj');
  });

  it('leaves rows that already carry the marker alone', () => {
    chat.topic = { hasGoal: true, id: 'tpc', projectId: 'prj' };
    project.rows = { prj: [{ hasGoal: true, id: 'tpc' }] };

    renderHook(() => useMarkSidebarTopicGoal('tpc', true));

    expect(chat.dispatch).not.toHaveBeenCalled();
    expect(project.refresh).not.toHaveBeenCalled();
  });

  it('clears the marker once the server confirms the last goal is gone', () => {
    chat.topic = { hasGoal: true, id: 'tpc', projectId: 'prj' };
    project.rows = { prj: [{ hasGoal: true, id: 'tpc' }] };

    renderHook(() => useMarkSidebarTopicGoal('tpc', false));

    expect(chat.dispatch).toHaveBeenCalledWith({
      id: 'tpc',
      type: 'updateTopic',
      value: { hasGoal: false },
    });
    expect(project.refresh).toHaveBeenCalledWith('prj');
  });

  it('leaves both lists alone until the server has confirmed the goals', () => {
    chat.topic = { hasGoal: true, id: 'tpc', projectId: 'prj' };
    project.rows = { prj: [{ hasGoal: false, id: 'tpc' }] };

    renderHook(() => useMarkSidebarTopicGoal('tpc', undefined));

    expect(chat.dispatch).not.toHaveBeenCalled();
    expect(project.refresh).not.toHaveBeenCalled();
  });
});

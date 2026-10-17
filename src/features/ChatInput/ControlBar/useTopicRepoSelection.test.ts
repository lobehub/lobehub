import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingTopicRepos, setPendingTopicRepos } from '@/store/chat/pendingTopicRepos';

import { useTopicRepoSelection } from './useTopicRepoSelection';

const REPO = 'https://github.com/lobehub/lobehub';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  topics: {} as Record<string, { repos?: string[]; workingDirectory?: string }>,
  updateTopicMetadata: vi.fn(),
}));

vi.mock('../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.activeTopicId,
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [id, { id, metadata }]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
    }),
}));

beforeEach(() => {
  // The main column's topic stays globally active while a side pane renders another.
  state.activeTopicId = 'main-topic';
  state.composerTopicId = undefined;
  state.topics = {
    'main-topic': { repos: [REPO], workingDirectory: REPO },
    'pane-topic': {},
  };
  state.updateTopicMetadata.mockReset();
  setPendingTopicRepos('agent-1', []);
});

describe('useTopicRepoSelection', () => {
  it("toggles repos on the composer's own topic rather than the global active topic", async () => {
    state.composerTopicId = 'pane-topic';
    const { result } = renderHook(() => useTopicRepoSelection('agent-1', true));

    expect(result.current.displayRepos).toEqual([]);
    await act(() => result.current.toggleRepo(REPO));

    expect(state.updateTopicMetadata).toHaveBeenCalledWith('pane-topic', {
      repos: [REPO],
      workingDirectory: REPO,
      workingDirectoryConfig: { path: REPO, repoType: 'github' },
    });
  });

  it('buffers the selection when the composer conversation has no topic, even with an active topic', async () => {
    state.composerTopicId = null;
    const { result } = renderHook(() => useTopicRepoSelection('agent-1', true));

    await act(() => result.current.toggleRepo(REPO));

    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
    expect(getPendingTopicRepos('agent-1')).toEqual([REPO]);
    expect(result.current.displayRepos).toEqual([REPO]);
  });

  it('ignores toggles without edit permission', async () => {
    state.composerTopicId = 'pane-topic';
    const { result } = renderHook(() => useTopicRepoSelection('agent-1', false));

    await act(() => result.current.toggleRepo(REPO));

    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
  });
});

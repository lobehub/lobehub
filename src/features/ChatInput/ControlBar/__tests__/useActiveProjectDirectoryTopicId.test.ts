import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveProjectDirectoryTopicId } from '../useProjectTopicDirectory';

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  topics: {} as Record<string, { projectWorkingDirectoryId?: string | null }>,
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector(state),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (s: typeof state) => s.topics[id],
  },
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => [],
  useProjectDirectoryStore: () => () => undefined,
}));

describe('useActiveProjectDirectoryTopicId', () => {
  beforeEach(() => {
    state.composerTopicId = undefined;
  });

  it('names the open conversation when it runs in a project directory', () => {
    state.activeTopicId = 'project-topic';
    state.topics = { 'project-topic': { projectWorkingDirectoryId: 'directory-1' } };
    expect(renderHook(() => useActiveProjectDirectoryTopicId()).result.current).toBe(
      'project-topic',
    );
  });

  it('leaves ordinary conversations — including directory-less project ones — to the general picker', () => {
    state.activeTopicId = 'plain-topic';
    state.topics = { 'plain-topic': { projectWorkingDirectoryId: null } };
    expect(renderHook(() => useActiveProjectDirectoryTopicId()).result.current).toBeUndefined();

    state.activeTopicId = undefined;
    expect(renderHook(() => useActiveProjectDirectoryTopicId()).result.current).toBeUndefined();
  });

  // A side-by-side portal pane renders another topic while the main column's
  // topic stays globally active.
  it("follows the composer's own topic rather than the global active topic", () => {
    state.activeTopicId = 'plain-topic';
    state.composerTopicId = 'project-topic';
    state.topics = {
      'plain-topic': { projectWorkingDirectoryId: null },
      'project-topic': { projectWorkingDirectoryId: 'directory-1' },
    };
    expect(renderHook(() => useActiveProjectDirectoryTopicId()).result.current).toBe(
      'project-topic',
    );

    state.activeTopicId = 'project-topic';
    state.composerTopicId = null;
    expect(renderHook(() => useActiveProjectDirectoryTopicId()).result.current).toBeUndefined();
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStagedNewTopicDirectory } from './useStagedNewTopicDirectory';

const state = vi.hoisted(() => ({
  context: { agentId: 'agent-1', topicId: null as string | null },
  pendingNewTopicDirectory: undefined as
    { agentId: string; projectWorkingDirectoryId: string } | undefined,
}));

const directories = vi.hoisted(() => [
  {
    deviceId: 'device-b',
    deviceName: 'Main MBP',
    id: 'dir-b',
    path: '/Users/me/Code/lobehub',
    projectId: 'project-1',
    projectName: 'LobeHub',
  },
]);

vi.mock('@/features/Conversation/store', () => ({
  contextSelectors: {
    agentId: (s: typeof state) => s.context.agentId,
    topicId: (s: typeof state) => s.context.topicId,
  },
  useConversationStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => directories,
  useProjectDirectoryStore: (selector: (s: object) => unknown) =>
    selector({ useFetchDirectories: () => undefined }),
}));

describe('useStagedNewTopicDirectory', () => {
  beforeEach(() => {
    state.context = { agentId: 'agent-1', topicId: null };
    state.pendingNewTopicDirectory = undefined;
  });

  // A device subgroup's "+" opens a blank conversation; the welcome has to say
  // the new topic starts in that project, on that device and directory.
  it('returns the staged directory of a blank conversation', () => {
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    const { result } = renderHook(() => useStagedNewTopicDirectory());

    expect(result.current).toBe(directories[0]);
  });

  it('is undefined without a staging', () => {
    const { result } = renderHook(() => useStagedNewTopicDirectory());

    expect(result.current).toBeUndefined();
  });

  it("ignores another agent's staging", () => {
    state.pendingNewTopicDirectory = { agentId: 'agent-2', projectWorkingDirectoryId: 'dir-b' };

    const { result } = renderHook(() => useStagedNewTopicDirectory());

    expect(result.current).toBeUndefined();
  });

  it('is undefined once the conversation has a topic', () => {
    state.context.topicId = 'topic-1';
    state.pendingNewTopicDirectory = { agentId: 'agent-1', projectWorkingDirectoryId: 'dir-b' };

    const { result } = renderHook(() => useStagedNewTopicDirectory());

    expect(result.current).toBeUndefined();
  });
});

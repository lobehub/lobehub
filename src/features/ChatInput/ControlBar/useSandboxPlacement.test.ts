import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingSandboxSelection } from '@/store/chat/pendingSandboxSelection';

import { isPersistentSelection, useSandboxPlacement } from './useSandboxPlacement';

interface TopicSandbox {
  projectId?: string;
  sandboxDrive?: 'personal' | 'public';
  sandboxEnvironmentId?: string;
  sandboxInstanceId?: string;
  sandboxWorkingDirectory?: string;
  sessionId?: string;
}

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  creatingTopicIds: [] as string[],
  draft: undefined as { agentId: string; projectId: string } | undefined,
  refreshTopicDetail: vi.fn(),
  topics: {} as Record<string, TopicSandbox>,
  updateTopicMetadata: vi.fn(),
  useFetchTopicDetail: vi.fn(),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.activeTopicId,
      creatingTopicIds: state.creatingTopicIds,
      pendingNewTopicDirectory: state.draft,
      topicDataMap: {},
      refreshTopicDetail: state.refreshTopicDetail,
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, { projectId, sessionId, ...metadata }]) => [
          id,
          { id, metadata, projectId, sessionId },
        ]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
      useFetchTopicDetail: state.useFetchTopicDetail,
    }),
}));

beforeEach(() => {
  // The main column's topic stays globally active while a side pane renders another.
  state.activeTopicId = 'main-topic';
  state.draft = undefined;
  state.creatingTopicIds = [];
  state.topics = {
    'main-topic': { sandboxInstanceId: 'main-instance' },
    'pane-topic': { sandboxDrive: 'personal', sandboxWorkingDirectory: 'reports' },
  };
  state.updateTopicMetadata.mockReset();
  state.refreshTopicDetail.mockReset();
  state.useFetchTopicDetail.mockReset();
});

describe('useSandboxPlacement', () => {
  it('reads and writes the given topic instead of the global active topic', async () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'pane-topic'));

    expect(result.current.selection).toEqual({
      drive: 'personal',
      instanceId: undefined,
      workingDirectory: 'reports',
    });
    expect(result.current.topicId).toBe('pane-topic');

    await act(() => result.current.setSelection({ drive: 'public', instanceId: 'pane-instance' }));

    // Picking an environment directory clears the folder, so the two never
    // both stand on one topic; the drive travels with whichever was picked.
    expect(state.updateTopicMetadata).toHaveBeenCalledWith('pane-topic', {
      sandboxDrive: 'public',
      sandboxInstanceId: 'pane-instance',
      sandboxWorkingDirectory: undefined,
    });
  });

  it('clears both halves when the temporary sandbox is picked', async () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'pane-topic'));

    await act(() => result.current.setSelection({ drive: 'personal' }));

    expect(state.updateTopicMetadata).toHaveBeenCalledWith('pane-topic', {
      sandboxDrive: undefined,
      sandboxInstanceId: undefined,
      sandboxWorkingDirectory: undefined,
    });
  });

  it('buffers the choice for a conversation without a topic even while another topic is active', async () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-new-topic', null));

    expect(result.current.selection).toEqual({});
    expect(result.current.topicId).toBeUndefined();

    await act(() => result.current.setSelection({ workingDirectory: '.' }));

    expect(state.updateTopicMetadata).not.toHaveBeenCalled();
    expect(getPendingSandboxSelection('agent-new-topic')).toEqual({ workingDirectory: '.' });
  });

  // ROOT CAUSE:
  //
  // A project conversation opened right after the project home created it is in
  // no loaded topic list. The chip read it as having no metadata (a temporary
  // sandbox while it worked in a repository), and a repository pick reached the
  // server but nothing local read it back — the pick looked ignored.
  //
  // Before: an unlisted topic was neither fetched nor read back.
  // After: it is fetched by id, and read back after a write.
  it('fetches an unlisted topic and reads it back after a pick', async () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'fresh-topic'));

    expect(state.useFetchTopicDetail).toHaveBeenLastCalledWith('fresh-topic');

    await act(() => result.current.setSelection({ environmentId: 'env-repo' }));

    expect(state.updateTopicMetadata).toHaveBeenCalledWith(
      'fresh-topic',
      expect.objectContaining({ sandboxEnvironmentId: 'env-repo' }),
    );
    expect(state.refreshTopicDetail).toHaveBeenCalledWith('fresh-topic', true);
  });

  // The write has landed when the read-back runs; its failure must not make
  // the pick look failed (and so go unremembered for the next conversation).
  it('resolves a pick whose save landed even if the read-back fails', async () => {
    state.refreshTopicDetail.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'fresh-topic'));

    await expect(
      act(() => result.current.setSelection({ workingDirectory: 'reports' })),
    ).resolves.toBeUndefined();
    expect(state.updateTopicMetadata).toHaveBeenCalled();
  });

  it('leaves a listed topic to the list it is in', async () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'pane-topic'));

    expect(state.useFetchTopicDetail).toHaveBeenLastCalledWith(undefined);

    await act(() => result.current.setSelection({ environmentId: 'env-repo' }));

    expect(state.refreshTopicDetail).not.toHaveBeenCalled();
  });

  it("names the conversation's project", () => {
    state.topics['project-topic'] = { projectId: 'proj_1' };

    const { result } = renderHook(() => useSandboxPlacement('agent-1', 'project-topic'));

    expect(result.current.projectId).toBe('proj_1');
  });

  // A project sidebar "+" stages a blank draft; it is the project's before a
  // topic exists, and only for the agent it was staged on.
  it("names a project draft's project, for its own agent only", () => {
    state.draft = { agentId: 'agent-1', projectId: 'proj_1' };

    expect(renderHook(() => useSandboxPlacement('agent-1', null)).result.current.projectId).toBe(
      'proj_1',
    );
    expect(
      renderHook(() => useSandboxPlacement('agent-2', null)).result.current.projectId,
    ).toBeUndefined();
  });

  // A first send drops the draft before the pane moves to the topic it mints;
  // that topic, still being created, keeps naming the project meanwhile.
  it('names the project of the topic a first send is creating, for its own agent only', () => {
    state.topics['minted-topic'] = { projectId: 'proj_1', sessionId: 'agent-1' };
    state.creatingTopicIds = ['minted-topic'];

    expect(renderHook(() => useSandboxPlacement('agent-1', null)).result.current.projectId).toBe(
      'proj_1',
    );
    expect(
      renderHook(() => useSandboxPlacement('agent-2', null)).result.current.projectId,
    ).toBeUndefined();
  });

  it('follows the global active topic when no topic is given', () => {
    const { result } = renderHook(() => useSandboxPlacement('agent-1'));

    expect(result.current.selection).toEqual({
      drive: undefined,
      instanceId: 'main-instance',
      workingDirectory: undefined,
    });
    expect(result.current.topicId).toBe('main-topic');
  });
});

describe('isPersistentSelection', () => {
  it('reads the drive root as a choice, and nothing as the temporary sandbox', () => {
    expect(isPersistentSelection({ workingDirectory: '.' })).toBe(true);
    expect(isPersistentSelection({ instanceId: 'i' })).toBe(true);
    expect(isPersistentSelection({})).toBe(false);
  });
});

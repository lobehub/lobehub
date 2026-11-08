import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingSandboxSelection } from '@/store/chat/pendingSandboxSelection';

import { isPersistentSelection, useSandboxPlacement } from './useSandboxPlacement';

interface TopicSandbox {
  sandboxDrive?: 'personal' | 'public';
  sandboxInstanceId?: string;
  sandboxWorkingDirectory?: string;
}

const state = vi.hoisted(() => ({
  activeTopicId: undefined as string | undefined,
  topics: {} as Record<string, TopicSandbox>,
  updateTopicMetadata: vi.fn(),
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
  state.topics = {
    'main-topic': { sandboxInstanceId: 'main-instance' },
    'pane-topic': { sandboxDrive: 'personal', sandboxWorkingDirectory: 'reports' },
  };
  state.updateTopicMetadata.mockReset();
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
